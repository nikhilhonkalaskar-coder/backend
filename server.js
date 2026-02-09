import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { Pool } from 'pg';

const app = express();

/* =========================
   Middleware
========================= */
app.use(cors({
  origin: '*', // In production, restrict this to your domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

/* =========================
   POSTGRESQL POOL
========================= */
const pool = new Pool({
  host: process.env.PG_HOST,
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASS,
  port: 5432,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   In-memory stores for OTPs
========================= */
const OTP_STORE = {};

/* =========================
   Helpers
========================= */
const normalizePhone = (phone) => {
  if (!phone) return null;
  return phone.startsWith("91") ? phone.slice(2) : phone;
};

const interaktRequest = axios.create({
  baseURL: "https://api.interakt.ai/v1/public/message/",
  headers: {
    Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
    "Content-Type": "application/json"
  }
});

/* =========================
   API Routes
========================= */
app.post("/api/send-otp", async (req, res, next) => {
  let { phone } = req.body;
  phone = normalizePhone(phone);

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "Invalid mobile number" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  OTP_STORE[phone] = { otp, expires: Date.now() + 5 * 60 * 1000 };
  console.log(`📨 OTP for ${phone}: ${otp}`);

  try {
    await interaktRequest.post("", {
      countryCode: "91", phoneNumber: phone, type: "Template", template: {
        name: "otp_verification", languageCode: "en", bodyValues: [otp], buttonValues: { "0": [otp] }
      }
    });
    res.json({ success: true, message: "OTP sent successfully." });
  } catch (err) {
    console.error("OTP sending error:", err.response?.data || err.message);
    // Pass the error to the central error handler
    next(err);
  }
});

app.post("/api/verify-otp", async (req, res, next) => {
  let { phone, otp, name, email, city } = req.body;
  phone = normalizePhone(phone);
  const record = OTP_STORE[phone];

  if (!record) return res.status(400).json({ verified: false, message: "OTP not found or session expired." });
  if (Date.now() > record.expires) {
    delete OTP_STORE[phone];
    return res.status(400).json({ verified: false, message: "OTP has expired." });
  }
  if (record.otp !== otp) return res.status(400).json({ verified: false, message: "Incorrect OTP." });

  try {
    // Simple INSERT without ON CONFLICT
    const result = await pool.query(
      `INSERT INTO clients (name, phone, email, city) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, phone, email, city]
    );
    
    delete OTP_STORE[phone];

    const defaultRedirectUrl = process.env.DEFAULT_REDIRECT_URL || 'https://www.tusharbhumkar.com/';
    res.json({ verified: true, message: "Verified! Submitted successfully.", redirectUrl: defaultRedirectUrl });

  } catch (err) {
    console.error('Database save error:', err);
    // Check for the specific duplicate key error code
    if (err.code === '23505') { // 23505 is the code for unique_violation
        res.status(409).json({ verified: false, message: "This phone number has already been registered." });
    } else {
        // Pass any other error to the central handler
        next(err);
    }
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});


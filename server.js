import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { Pool } from 'pg';

const app = express();

/* =========================
   CORS (NODE 22 SAFE)
========================= */
app.use(cors({
  origin: '*', // In production, restrict this to your domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* =========================
   JSON FOR NORMAL APIs
========================= */
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
  ssl: { rejectUnauthorized: false }, // Required for many cloud DB providers
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
  // Remove "91" prefix if it exists, otherwise keep as is
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
   SEND OTP
========================= */
app.post("/api/send-otp", async (req, res) => {
  let { phone } = req.body;
  phone = normalizePhone(phone);

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "Invalid mobile number" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  OTP_STORE[phone] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000 // 5 minutes expiry
  };

  console.log(`📨 OTP for ${phone}: ${otp}`);

  try {
    await interaktRequest.post("", {
      countryCode: "91",
      phoneNumber: phone,
      type: "Template",
      template: {
        name: "otp_verification", // Make sure this template exists in Interakt
        languageCode: "en",
        bodyValues: [otp],
        buttonValues: {
          "0": [otp] // For OTP button
        }
      }
    });

    res.json({ success: true, message: "OTP sent successfully." });
  } catch (err) {
    console.error("OTP sending error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to send OTP." });
  }
});

/* =========================
   VERIFY OTP & SAVE CLIENT (MODIFIED)
========================= */
app.post("/api/verify-otp", async (req, res) => {
  let { phone, otp, name, email, city } = req.body;
  phone = normalizePhone(phone);

  const record = OTP_STORE[phone];
  if (!record) return res.status(400).json({ verified: false, message: "OTP not found or session expired." });
  if (Date.now() > record.expires) {
    delete OTP_STORE[phone]; // Clean up expired OTP
    return res.status(400).json({ verified: false, message: "OTP has expired." });
  }
  if (record.otp !== otp) return res.status(400).json({ verified: false, message: "Incorrect OTP." });

  // OTP is valid, now save the client to the database
  try {
    const result = await pool.query(
      `INSERT INTO clients (name, phone, email, city) VALUES ($1, $2, $3, $4) ON CONFLICT (phone) DO NOTHING RETURNING id`,
      [name, phone, email, city]
    );
    
    // Clean up the used OTP
    delete OTP_STORE[phone];

    // Respond with success
    const defaultRedirectUrl = process.env.DEFAULT_REDIRECT_URL || 'https://www.tusharbhumkar.com/';
    res.json({
      verified: true,
      message: "Verified! Submitted successfully.",
      redirectUrl: defaultRedirectUrl
    });

  } catch (err) {
    console.error('Database save error:', err);
    res.status(500).json({ verified: false, message: "Could not save your details. Please try again." });
  }
});


/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// End of file

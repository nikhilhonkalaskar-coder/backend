import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import axios from 'axios';
import { Pool } from 'pg';
// import { config } from 'dotenv'; // <-- CORRECTED IMPORT


const app = express();

/* =========================
   CORS (NODE 22 SAFE)
========================= */
app.use(cors({
  origin: '*',
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
  ssl: { rejectUnauthorized: false },
});

/* =========================
   In-memory stores (use DB later)
========================= */
const OTP_STORE = {};
const VERIFIED_USERS = {};

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
    expires: Date.now() + 5 * 60 * 1000
  };

  console.log("📨 OTP:", otp);

  try {
    await interaktRequest.post("", {
      countryCode: "91",
      phoneNumber: phone,
      type: "Template",
      template: {
        name: "otp_verification",
        languageCode: "en",
        bodyValues: [otp],
        buttonValues: {
          "0": [otp]
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("OTP error:", err.response?.data || err.message);
    res.status(500).json({ success: false });
  }
});

/* =========================
   VERIFY OTP
========================= */
app.post("/api/verify-otp", async (req, res) => {
  let { phone, otp, name, email, city } = req.body;
  phone = normalizePhone(phone);

  const record = OTP_STORE[phone];
  if (!record) return res.json({ verified: false, message: "OTP not found" });
  if (Date.now() > record.expires) return res.json({ verified: false, message: "OTP expired" });
  if (record.otp !== otp) return res.json({ verified: false, message: "Wrong OTP" });

  delete OTP_STORE[phone];
  VERIFIED_USERS[phone] = true;

  res.json({ verified: true,});
});

/* =========================
   SAVE CLIENT TO DB AND REDIRECT
========================= */
app.post('/api/save-client', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      city,
      redirectUrl
    } = req.body;

    const result = await pool.query(
      `INSERT INTO clients
       (name, phone, email, city)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [
        name,
        phone,
        email,
        city
      ]
    );

    const defaultRedirectUrl = process.env.DEFAULT_REDIRECT_URL || 'https://www.tusharbhumkar.com/';
    const finalRedirectUrl = redirectUrl || defaultRedirectUrl;

    res.json({ 
      success: true, 
      id: result.rows[0].id,
      redirectUrl: finalRedirectUrl
    });

  } catch (err) {
    console.error('Save client error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/* =========================
   REDIRECT ENDPOINT
========================= */
app.get('/redirect/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { url } = req.query;
    
    const clientResult = await pool.query(
      'SELECT id, name FROM clients WHERE id = $1',
      [clientId]
    );
    
    if (clientResult.rows.length === 0) {
      return res.status(404).send('Client not found');
    }
    
    const redirectUrl = url || process.env.DEFAULT_REDIRECT_URL || 'https://www.tusharbhumkar.com/';
    
    console.log(`Redirecting client ${clientId} to: ${redirectUrl}`);
    res.redirect(redirectUrl);
    
  } catch (err) {
    console.error('Redirect error:', err);
    res.status(500).send('Internal server error');
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});


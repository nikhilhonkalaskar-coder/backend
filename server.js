import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// In-memory stores (use DB later)
// ==============================
const OTP_STORE = {};
const VERIFIED_USERS = {};

// ==============================
// Helpers
// ==============================
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

// ==============================
// SEND OTP
// ==============================
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

// ==============================
// VERIFY OTP
// ==============================
app.post("/api/verify-otp", async (req, res) => {
  let { phone, otp, name, email, city } = req.body;
  phone = normalizePhone(phone);

  const record = OTP_STORE[phone];
  if (!record) return res.json({ verified: false, message: "OTP not found" });
  if (Date.now() > record.expires) return res.json({ verified: false, message: "OTP expired" });
  if (record.otp !== otp) return res.json({ verified: false, message: "Wrong OTP" });

  delete OTP_STORE[phone];
  VERIFIED_USERS[phone] = true;

  try {
    await interaktRequest.post("", {
      countryCode: "91",
      phoneNumber: phone,
      type: "Template",
      template: {
        name: "chat_unlocked",
        languageCode: "en",
        bodyValues: [name || "there"]
      }
    });
  } catch (err) {
    console.error("Unlock msg error:", err.message);
  }

  const message = `
*Tushar Bhumkar Institute*

Name: ${name}
Mobile: ${phone}
Email: ${email || "N/A"}
City: ${city || "N/A"}
`;

  const redirectUrl =
    `https://wa.me/${process.env.WHATSAPP_CHAT_NUMBER}?text=` +
    encodeURIComponent(message);

  res.json({ verified: true, redirectUrl });
});

// ==============================
// INTERAKT WEBHOOK
// ==============================
app.post("/api/interakt/webhook", async (req, res) => {
  try {
    if (req.body.type !== "message_received") return res.sendStatus(200);

    const data = req.body.data;
    if (data.chat_message_type !== "CustomerMessage") return res.sendStatus(200);

    const fullPhone = data.customer?.channel_phone_number; // 919XXXXXXXXX
    const shortPhone = normalizePhone(fullPhone);

    if (!VERIFIED_USERS[shortPhone]) {
      await interaktRequest.post("", {
        countryCode: "91",
        phoneNumber: shortPhone,
        type: "Text",
        text: {
          body: "⚠️ Please verify OTP on the website to continue chatting."
        }
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// ==============================
// START SERVER
// ==============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});

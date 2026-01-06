import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// In-memory Stores (use DB later)
// ==============================
const OTP_STORE = {};        // { phone: { otp, expires } }
const VERIFIED_USERS = {};  // { phone: true }

// ==============================
// HELPERS
// ==============================
const normalizePhone = (phone) => {
  if (!phone) return null;
  return phone.startsWith("91") ? phone.slice(2) : phone;
};

// ==============================
// SEND OTP
// ==============================
app.post("/api/send-otp", async (req, res) => {
  let { phone } = req.body;
  phone = normalizePhone(phone);

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: "Invalid mobile number"
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000;

  OTP_STORE[phone] = { otp, expires };
  console.log("Generated OTP:", otp);

  try {
    await axios.post(
      "https://api.interakt.ai/v1/public/message",
      {
        countryCode: "91",
        phoneNumber: phone,
        type: "Template",
        template: {
          name: "otp_verification",
          languageCode: "en",
          bodyValues: [otp]
        }
      },
      {
        headers: {
          Authorization: process.env.INTERAKT_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    res.json({ success: true, message: "OTP sent successfully" });

  } catch (err) {
    console.error("OTP error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

// ==============================
// VERIFY OTP
// ==============================
app.post("/api/verify-otp", async (req, res) => {
  let { phone, otp, name } = req.body;
  phone = normalizePhone(phone);

  const record = OTP_STORE[phone];

  if (!record) {
    return res.json({ verified: false, message: "OTP not found" });
  }

  if (Date.now() > record.expires) {
    delete OTP_STORE[phone];
    return res.json({ verified: false, message: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.json({ verified: false, message: "Wrong OTP" });
  }

  delete OTP_STORE[phone];
  VERIFIED_USERS[phone] = true;

  // Send "Chat Unlocked" template
  try {
    await axios.post(
      "https://api.interakt.ai/v1/public/message",
      {
        countryCode: "91",
        phoneNumber: phone,
        type: "Template",
        template: {
          name: "chat_unlocked",
          languageCode: "en",
          bodyValues: [name || "there"]
        }
      },
      {
        headers: {
          Authorization: process.env.INTERAKT_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (e) {
    console.error("Chat unlocked error:", e.response?.data || e.message);
  }

  res.json({
    verified: true,
    message: "OTP verified successfully"
  });
});

// ==============================
// INTERAKT WEBHOOK
// ==============================
app.post("/api/interakt/webhook", async (req, res) => {
  try {
    const event = req.body;

    if (
      event.type !== "message" ||
      event.message?.direction !== "incoming"
    ) {
      return res.sendStatus(200);
    }

    let phone = event.message?.from?.phone;
    phone = normalizePhone(phone);
    if (!phone) return res.sendStatus(200);

    if (!VERIFIED_USERS[phone]) {
      await axios.post(
        "https://api.interakt.ai/v1/public/message",
        {
          countryCode: "91",
          phoneNumber: phone,
          type: "Template",
          template: {
            name: "complete_otp_first",
            languageCode: "en"
          }
        },
        {
          headers: {
            Authorization: process.env.INTERAKT_API_KEY,
            "Content-Type": "application/json"
          }
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// ==============================
// START SERVER
// ==============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("INTERAKT KEY LOADED:", !!process.env.INTERAKT_API_KEY);
  console.log(`✅ Server running on port ${PORT}`);
});

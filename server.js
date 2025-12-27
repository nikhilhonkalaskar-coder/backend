// backend/index.js
import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors()); // allow requests from any origin
app.use(express.json());

const OTP_STORE = {}; // in-memory OTP storage (replace with Redis/DB for production)

// 🔹 SEND OTP
app.post("/api/send-otp", async (req, res) => {
  const { phone } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000);

  try {
    await axios.post(
      "https://api.interakt.ai/v1/public/message/",
      {
        countryCode: "91",
        phoneNumber: phone,
        type: "Template",
        template: {
          name: "otp_verification",
          languageCode: "en",
          bodyValues: [otp.toString()],
          buttonValues: [[otp.toString()]]
        }
      },
      {
        headers: {
          Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err.response?.data);
    res.status(500).json({ success: false });
  }
});


// 🔹 VERIFY OTP
app.post("/api/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  const record = OTP_STORE[phone];

  if (!record) return res.json({ verified: false, message: "OTP not found" });

  if (Date.now() > record.expires) {
    delete OTP_STORE[phone];
    return res.json({ verified: false, message: "OTP expired" });
  }

  if (record.otp != otp) return res.json({ verified: false, message: "Wrong OTP" });

  delete OTP_STORE[phone];

  // Redirect WhatsApp chat
  const redirectUrl = `https://wa.me/${process.env.WHATSAPP_CHAT_NUMBER}?text=Hello%20I%20am%20verified`;

  res.json({ verified: true, redirectUrl });
});

// 🔹 Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Backend running on port", PORT));




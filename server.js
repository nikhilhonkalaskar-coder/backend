import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

const OTP_STORE = {}; // { phone: { otp, expires } }

// 🔹 SEND OTP
app.post("/api/send-otp", async (req, res) => {
  const { name, phone, email, city } = req.body;

  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);
  const expires = Date.now() + 5 * 60 * 1000; // 5 min

  OTP_STORE[phone] = { otp, expires };

  try {
    await axios.post(
      "https://api.interakt.ai/v1/public/message/",
      {
        countryCode: "91",
        phoneNumber: phone,
        type: "Template",
        template: {
          name: "otp_verification", // APPROVED TEMPLATE
          languageCode: "en",
          bodyValues: [otp.toString()]
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
    console.error("OTP error", err.response?.data);
    res.status(500).json({ success: false });
  }
});

// 🔹 VERIFY OTP
app.post("/api/verify-otp", (req, res) => {
  const { phone, otp } = req.body;

  const record = OTP_STORE[phone];

  if (!record) {
    return res.json({ verified: false });
  }

  if (Date.now() > record.expires) {
    delete OTP_STORE[phone];
    return res.json({ verified: false });
  }

  if (record.otp != otp) {
    return res.json({ verified: false });
  }

  delete OTP_STORE[phone];

  const redirectUrl = `https://wa.me/${process.env.WHATSAPP_CHAT_NUMBER}?text=Hello%20I%20am%20verified`;

  res.json({
    verified: true,
    redirectUrl
  });
});

app.listen(process.env.PORT, () => {
  console.log("Server running on port", process.env.PORT);
});

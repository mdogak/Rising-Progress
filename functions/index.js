const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const nodemailer = require("nodemailer");

initializeApp();

// Secrets are configured during deployment with:
// firebase functions:secrets:set SMTP_PASS
// firebase functions:secrets:set SMTP_USER
// firebase functions:secrets:set EMAIL_FROM
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_USER = defineSecret("SMTP_USER");
const EMAIL_FROM = defineSecret("EMAIL_FROM");

const ALLOWED_REDIRECT_HOSTS = new Set([
  "risingprogress.com",
  "www.risingprogress.com"
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeRedirect(redirect) {
  const fallback = "https://risingprogress.com/progress.html";

  if (!redirect) return fallback;

  try {
    const url = new URL(redirect, fallback);

    if (!ALLOWED_REDIRECT_HOSTS.has(url.hostname)) {
      return fallback;
    }

    if (url.protocol !== "https:") {
      return fallback;
    }

    return url.toString();
  } catch (err) {
    return fallback;
  }
}

async function createTransport() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASS.value()
    }
  });
}

exports.sendApprovedUserSignInLink = onCall(
  {
    region: "us-central1",
    secrets: [SMTP_PASS, SMTP_USER, EMAIL_FROM]
  },
  async (request) => {
    const email = normalizeEmail(request.data?.email);
    const redirect = sanitizeRedirect(request.data?.redirect);

    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required.");
    }

    // The user will return to login.html with the redirect preserved.
    const loginReturnUrl = new URL("https://risingprogress.com/login.html");
    loginReturnUrl.searchParams.set("redirect", redirect);

    const actionCodeSettings = {
      url: loginReturnUrl.toString(),
      handleCodeInApp: true
    };

    try {
      // Only approved / pre-created users can receive a sign-in link.
      await getAuth().getUserByEmail(email);

      const signInLink = await getAuth().generateSignInWithEmailLink(
        email,
        actionCodeSettings
      );

      const transporter = await createTransport();

      await transporter.sendMail({
        from: EMAIL_FROM.value(),
        to: email,
        subject: "Your Rising Progress secure sign-in link",
        text:
`Copy the link below and paste it into your active tab to sign in to Rising Progress:

${signInLink}

If you did not request this email, you can ignore it.`,
        html:
`<p><strong> Right click to copy the link below and paste it into the tab you are working in </strong>:</p>
<p><a href="${signInLink}">Sign in securely</a></p>
<p>If you did not request this email, you can ignore it.</p>`
      });

      return {
        ok: true,
        message: "If your account is approved, you will receive an email shortly."
      };
    } catch (err) {
      // Do not reveal whether the email exists.
      logger.error("sendApprovedUserSignInLink failed", err);

      return {
        ok: true,
        message: "If your account is authorized, you will receive an email shortly."
      };
    }
  }
);

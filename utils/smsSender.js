/**
 * SMS / OTP Sender Service
 *
 * CURRENT MODE: Demo (no real SMS is sent)
 *   - OTP is printed to the server console for testing.
 *   - Set SMS_PROVIDER=demo in your .env to keep this behaviour explicitly.
 *
 * TO INTEGRATE A REAL SMS GATEWAY:
 *   1. Set SMS_PROVIDER=<your_provider> in .env  (e.g. "twilio", "msg91", "fast2sms")
 *   2. Add the required credentials to .env       (see provider block below)
 *   3. Install the provider's npm package if needed
 *   4. Fill in the provider block in sendOTP() below
 *
 * This function must always resolve — never throw — so the auth route stays clean.
 * Return { success: true } on delivery, { success: false, error: string } on failure.
 */

const SMS_PROVIDER = (process.env.SMS_PROVIDER || 'demo').toLowerCase();

async function sendOTP(mobile, otp, applicationNo) {
  switch (SMS_PROVIDER) {

    // ------------------------------------------------------------------ DEMO
    case 'demo':
    default: {
      console.log(
        `[OTP DEMO] Application: ${applicationNo} | Mobile: ${mobile || 'N/A'} | OTP: ${otp}`
      );
      return { success: true };
    }

    // ---------------------------------------------------------------- MSG91
    // Required env vars: MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID
    case 'msg91': {
      /*
      const response = await fetch('https://api.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: process.env.MSG91_AUTH_KEY },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          mobile: `91${mobile}`,
          otp
        })
      });
      const data = await response.json();
      return data.type === 'success'
        ? { success: true }
        : { success: false, error: data.message || 'MSG91 error' };
      */
      console.warn('[SMS] MSG91 provider selected but not yet configured.');
      return { success: false, error: 'MSG91 not configured' };
    }

    // ----------------------------------------------------------- FAST2SMS
    // Required env vars: FAST2SMS_API_KEY
    case 'fast2sms': {
      /*
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: mobile
        })
      });
      const data = await response.json();
      return data.return
        ? { success: true }
        : { success: false, error: data.message || 'Fast2SMS error' };
      */
      console.warn('[SMS] Fast2SMS provider selected but not yet configured.');
      return { success: false, error: 'Fast2SMS not configured' };
    }

    // -------------------------------------------------------------- TWILIO
    // Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
    case 'twilio': {
      /*
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `Your Bar Council OTP is: ${otp}. Valid for 5 minutes.`,
        from: process.env.TWILIO_FROM_NUMBER,
        to: `+91${mobile}`
      });
      return { success: true };
      */
      console.warn('[SMS] Twilio provider selected but not yet configured.');
      return { success: false, error: 'Twilio not configured' };
    }
  }
}

module.exports = { sendOTP };

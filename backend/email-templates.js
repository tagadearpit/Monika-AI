'use strict';

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const BRAND = {
    name: 'Monika AI',
    bg: '#120914',
    card: '#1c0e18',
    accent: '#ff6b9d',
    accentDeep: '#ff1493',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.6)',
    textFaint: 'rgba(255,255,255,0.4)',
    border: 'rgba(255,255,255,0.08)'
};

function emailLayout({ appUrl, preheader, bodyHtml }) {
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${BRAND.name}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${BRAND.card};border-radius:20px;border:1px solid ${BRAND.border};overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px;text-align:center;">
              <img src="${appUrl}/icon-192.png" width="48" height="48" alt="${BRAND.name}" style="border-radius:12px;display:block;margin:0 auto 12px;">
              <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:19px;font-weight:600;color:${BRAND.text};">${BRAND.name}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 32px;">
              <hr style="border:none;border-top:1px solid ${BRAND.border};margin:0 0 20px;">
              <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.textFaint};text-align:center;margin:0 0 8px;">This is an automated security email — please don't reply.</p>
              <p style="text-align:center;margin:0;">
                <a href="${appUrl}/" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.accent};text-decoration:none;">${appUrl.replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function otpBody({ otpCode, appUrl }) {
    return `
      <h1 style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:18px;font-weight:500;color:${BRAND.text};text-align:center;margin:12px 0 4px;">Your verification code</h1>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.textMuted};text-align:center;margin:0 0 22px;">Enter this code to finish signing in to ${BRAND.name}.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
        <tr><td style="background:rgba(255,107,157,0.08);border:1px solid rgba(255,107,157,0.35);border-radius:14px;padding:18px;text-align:center;">
          <span style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${BRAND.accent};">${escapeHtml(otpCode)}</span>
        </td></tr>
      </table>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.textMuted};text-align:center;margin:0 0 24px;">This code expires in <strong style="color:${BRAND.text};">5 minutes</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
        <tr><td align="center">
          <a href="${appUrl}/otp-verification" style="display:inline-block;background:linear-gradient(135deg,${BRAND.accent},${BRAND.accentDeep});color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:999px;">Enter code</a>
        </td></tr>
      </table>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textFaint};text-align:center;line-height:1.6;margin:0 0 12px;">Didn't request this? Someone may have mistyped their email address — you can safely ignore this message, no account changes will be made.</p>
    `;
}

function loginAlertBody({ browser, operatingSystem, time, appUrl }) {
    const safeBrowser = escapeHtml(browser || 'Unknown browser');
    const safeOs = escapeHtml(operatingSystem || 'Unknown device');
    const safeTime = escapeHtml(time || '');
    return `
      <h1 style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:18px;font-weight:500;color:${BRAND.text};text-align:center;margin:12px 0 4px;">New sign-in to your account</h1>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.textMuted};text-align:center;margin:0 0 20px;">We noticed a new sign-in to your ${BRAND.name} account. If this was you, no action is needed.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border-radius:14px;margin-bottom:22px;">
        <tr><td style="padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.text};">
            <tr>
              <td style="padding:5px 0;color:${BRAND.textFaint};">Device</td>
              <td style="padding:5px 0;text-align:right;">${safeBrowser} · ${safeOs}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:${BRAND.textFaint};">Time</td>
              <td style="padding:5px 0;text-align:right;">${safeTime}</td>
            </tr>
          </table>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
        <tr><td align="center">
          <a href="${appUrl}/settings?tab=devices" style="display:inline-block;background:linear-gradient(135deg,${BRAND.accent},${BRAND.accentDeep});color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:999px;">Review devices</a>
        </td></tr>
      </table>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.textFaint};text-align:center;line-height:1.6;margin:0 0 12px;"><strong style="color:#ff9eb8;">Wasn't you?</strong> Open Settings → Devices to sign that device out, then change your account credentials right away.</p>
    `;
}

function buildOtpEmail({ otpCode, appUrl }) {
    const cleanUrl = String(appUrl).replace(/\/$/, '');
    return {
        subject: `${otpCode} is your ${BRAND.name} verification code`,
        html: emailLayout({
            appUrl: cleanUrl,
            preheader: `Your verification code is ${otpCode}. It expires in 5 minutes.`,
            bodyHtml: otpBody({ otpCode, appUrl: cleanUrl })
        }),
        text: [
            `Your ${BRAND.name} verification code is: ${otpCode}`,
            `This code expires in 5 minutes.`,
            ``,
            `Continue at: ${cleanUrl}/otp-verification`,
            ``,
            `Didn't request this? You can safely ignore this email.`
        ].join('\n')
    };
}

function buildLoginAlertEmail({ browser, operatingSystem, time, appUrl }) {
    const cleanUrl = String(appUrl).replace(/\/$/, '');
    return {
        subject: `New sign-in to your ${BRAND.name} account`,
        html: emailLayout({
            appUrl: cleanUrl,
            preheader: `New sign-in from ${browser || 'a device'} on ${operatingSystem || 'an unknown OS'}.`,
            bodyHtml: loginAlertBody({ browser, operatingSystem, time, appUrl: cleanUrl })
        }),
        text: [
            `New sign-in to your ${BRAND.name} account.`,
            `Device: ${browser || 'Unknown browser'} on ${operatingSystem || 'Unknown device'}`,
            `Time: ${time || ''}`,
            ``,
            `Wasn't you? Review devices: ${cleanUrl}/settings?tab=devices`
        ].join('\n')
    };
}

module.exports = { buildOtpEmail, buildLoginAlertEmail };

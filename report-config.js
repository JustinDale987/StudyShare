/* ==========================================================================
   Report setup

   Reports are emailed to the address below through FormSubmit
   (https://formsubmit.co), so no server is needed. The first report you send
   triggers an activation email from FormSubmit: open it and click the
   confirmation link once, and every later report arrives normally.
   ========================================================================== */

export const REPORT_EMAIL = 'YOUR_GMAIL_ADDRESS@gmail.com';

export const isReportEmailConfigured =
  !REPORT_EMAIL.startsWith('YOUR_') && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(REPORT_EMAIL);

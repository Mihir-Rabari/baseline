import type { OutgoingEmail } from './email.service.js';

type Content = Omit<OutgoingEmail, 'to'>;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** One plain, mobile-friendly layout. No remote images or scripts, so it renders everywhere. */
function layout(clubName: string, heading: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#27272a">${p}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0f7a55;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#52525b">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:28px">
<tr><td>
<p style="margin:0 0 18px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#0f7a55">${escapeHtml(clubName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#18181b">${escapeHtml(heading)}</h1>
${body}${button}
<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#71717a">${footer ?? `You are receiving this because of activity on your ${escapeHtml(clubName)} account.`}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function plain(clubName: string, lines: string[], action?: { label: string; url: string }): string {
  return [clubName, '', ...lines, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n');
}

/** Staff registered a member: tell them their login and give a one-time link to choose a password. */
export function welcomeMemberEmail(input: { clubName: string; name: string; loginEmail: string; setPasswordUrl: string; validHours: number; planName?: string | null }): Content {
  const first = input.name.trim().split(/\s+/)[0] || 'there';
  const action = { label: 'Choose your password', url: input.setPasswordUrl };
  const plan = input.planName ? ` Your ${input.planName} membership is active.` : '';
  return {
    subject: `Welcome to ${input.clubName}: set up your login`,
    html: layout(input.clubName, `Welcome, ${first}`, [
      `You are now a member of ${escapeHtml(input.clubName)}.${escapeHtml(plan)} We have created an account so you can book courts, see your membership and view your orders online.`,
      `Your login is your email address: <strong>${escapeHtml(input.loginEmail)}</strong>. For your security we do not email passwords. Use the button below to choose one. The link works once and expires in ${input.validHours} hours.`,
    ], action),
    text: plain(input.clubName, [`Welcome, ${first}.`, `You are now a member of ${input.clubName}.${plan}`, `Your login is your email address: ${input.loginEmail}`, `For your security we do not email passwords. Use the link below to choose one. It works once and expires in ${input.validHours} hours.`], action),
  };
}

/** Someone created an account themselves on the website. */
export function accountCreatedEmail(input: { clubName: string; name: string; loginEmail: string; loginUrl: string; planName?: string | null }): Content {
  const first = input.name.trim().split(/\s+/)[0] || 'there';
  const action = { label: 'Sign in', url: input.loginUrl };
  const plan = input.planName ? ` We have noted your interest in the ${input.planName} plan. Visit the club to pay and activate it, or reply to this email.` : '';
  return {
    subject: `Your ${input.clubName} account is ready`,
    html: layout(input.clubName, `Welcome, ${first}`, [
      `Your account has been created. Sign in with <strong>${escapeHtml(input.loginEmail)}</strong> and the password you chose.${escapeHtml(plan)}`,
    ], action),
    text: plain(input.clubName, [`Welcome, ${first}.`, `Your account has been created. Sign in with ${input.loginEmail} and the password you chose.${plan}`], action),
  };
}

/** A password reset link the person asked for. */
export function passwordResetEmail(input: { clubName: string; name: string; resetUrl: string; validMinutes: number }): Content {
  const first = input.name.trim().split(/\s+/)[0] || 'there';
  const action = { label: 'Reset your password', url: input.resetUrl };
  return {
    subject: `Reset your ${input.clubName} password`,
    html: layout(input.clubName, 'Reset your password', [
      `Hi ${escapeHtml(first)}, we received a request to reset your password. The link works once and expires in ${input.validMinutes} minutes.`,
      'If you did not ask for this, you can ignore this email. Your password stays the same.',
    ], action),
    text: plain(input.clubName, [`Hi ${first}, we received a request to reset your password. The link works once and expires in ${input.validMinutes} minutes.`, 'If you did not ask for this, ignore this email.'], action),
  };
}

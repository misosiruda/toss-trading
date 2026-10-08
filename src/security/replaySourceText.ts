import { maskSensitiveText } from "./masking.js";

const credentialKeys = new Set([
  "token", "accesstoken", "refreshtoken", "idtoken", "authtoken", "apitoken", "bearertoken", "securitytoken",
  "authenticationtoken", "apikey", "key", "auth", "authorization",
  "proxyauthorization", "password", "passwd", "pwd", "secret", "clientsecret", "credential", "credentials",
  "cookie", "setcookie", "sessionid", "sessionkey", "sessiontoken", "signature", "sig",
  "xamzcredential", "xamzsecuritytoken", "xamzsignature", "xgoogcredential", "xgoogsignature", "xgoogapikey"
]);
// Start at a maximal key run; restarting inside dots/dashes only repeats failed scans.
const assignedKey = /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)(?:\[\])?\s*["'\]]*\s*[:=]/g;

/** Conservative credential syntax guard for already length-bounded source fields; never returns secret text. */
export function containsReplaySourceCredential(value: string): boolean {
  if (!/[=: @%\\\s]/.test(value)) return false;
  let candidate = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (maskSensitiveText(candidate) !== candidate || credentialSyntax(candidate)) return true;
    // Decode only ASCII spelling for detection. Preserve the original source bytes and never retain this view.
    const decoded = candidate.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u00([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  // Deeply encoded text cannot evade the bounded detector by exhausting its inspection budget.
  return true;
}

function credentialSyntax(value: string): boolean {
  for (const match of value.matchAll(assignedKey)) {
    const rawKey = match[1]!.toLowerCase();
    const key = rawKey.replace(/[_.-]/g, "");
    const lastSegment = rawKey.split(/[_.-]/).at(-1)!;
    if (credentialKeys.has(lastSegment) || credentialKeys.has(key) || credentialKeys.has(key.replace(/^x/, "")) ||
      /(?:access|refresh|id|csrf|xsrf|auth|api|bearer|security)token$|apikey$|clientsecret$|password$/.test(key)) return true;
  }
  return /(?:^|[\r\n])\s*Bearer\s+\S+/i.test(value) ||
    /\/\/[^\s/?#]*@/i.test(value) ||
    /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/.test(value);
}

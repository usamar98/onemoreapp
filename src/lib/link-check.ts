import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { AppError, safeUrl } from "./security";

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !/^2001:(?:db8|0):|^2002:/i.test(address)
    );
  return false;
}
// Pin each connection to validated DNS answers, including every redirect.
export async function checkDemoLink(value: string) {
  let url = new URL(safeUrl(value));
  for (let hop = 0; hop < 4; hop++) {
    if (url.port && !["80", "443"].includes(url.port))
      throw new AppError(
        "Demo checks support public HTTP/HTTPS on standard ports only.",
      );
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new AppError(
        "Demo checks cannot access private, local, or reserved network addresses. Verify this link manually.",
      );
    const address = addresses[0];
    const result = await new Promise<{ status: number; location: string }>(
      (resolve, reject) => {
        const req = (url.protocol === "https:" ? https : http).request(
          url,
          {
            method: "HEAD",
            agent: false,
            lookup: ((
              _host: string,
              _options: unknown,
              callback: (err: null, address: string, family: number) => void,
            ) => callback(null, address.address, address.family)) as never,
            headers: { "User-Agent": "Chapter-revival-check" },
          },
          (response) => {
            response.resume();
            resolve({
              status: response.statusCode || 0,
              location: String(response.headers.location || ""),
            });
          },
        );
        req.setTimeout(10000, () =>
          req.destroy(new Error("Demo check timed out.")),
        );
        req.on("error", reject);
        req.end();
      },
    );
    if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
      url = new URL(safeUrl(new URL(result.location, url).toString()));
      continue;
    }
    return result.status;
  }
  throw new AppError(
    "The demo link redirects too many times. Check its destination.",
  );
}

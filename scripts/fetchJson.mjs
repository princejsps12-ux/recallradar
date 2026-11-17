// A fetch of one openFDA URL as JSON for the developer scripts (check-demo-matches, make-eval-set --pull, preview/make-fixtures).
// openFDA answers 404 when a search has no hits: that is "no results", not an error.
//
// On some machines the operating system's own lookup (getaddrinfo, which Node's fetch and curl use) cannot resolve api.fda.gov
// while the DNS servers themselves answer fine (the name is an alias into cloud.gov): then every script fails with ENOTFOUND
// although nothing is wrong with the network. When the normal lookup fails this asks the DNS servers directly (Node's own
// resolver, which reads the same servers the system is set to) and connects to the address they give. Nothing about the
// machine's settings is touched, and the Forge app never uses this: it is for scripts run by hand.
import https from 'node:https';
import dns from 'node:dns';

function lookup(hostname, options, callback) {
  dns.lookup(hostname, options, (error, address, family) => {
    if (!error) return callback(null, address, family);
    dns.promises.resolve4(hostname).then(
      (addresses) => (options && options.all ? callback(null, addresses.map((a) => ({ address: a, family: 4 }))) : callback(null, addresses[0], 4)),
      () => callback(error),
    );
  });
}

export function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup, headers: { Accept: 'application/json' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode === 404) return resolve({ results: [] });
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`openFDA did not answer with JSON for ${url}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error(`openFDA did not answer in 30 seconds: ${url}`)));
  });
}

export function lireJson(req) {
  let b = req.body;
  if (!b) return {};
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return typeof b === 'object' ? b : {};
}

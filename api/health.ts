import { handleOptions, relayHealth, setCors } from './_lib/redditRelay.js';

export default function handler(req: any, res: any) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return res
      .status(405)
      .json({
        ok: false,
        error: { code: 'method_not_allowed', message: 'Use GET for this endpoint.' },
      });
  }
  return res.status(200).json(relayHealth());
}

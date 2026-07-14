import { handleComments } from '../_lib/redditRelay.js';

export default async function handler(req: any, res: any) {
  return handleComments(req, res);
}

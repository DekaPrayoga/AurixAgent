import { handleSearch } from '../_lib/redditRelay.js';

export default async function handler(req: any, res: any) {
  return handleSearch(req, res);
}

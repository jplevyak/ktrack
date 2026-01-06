import LevelPkg from "level";
const { Level } = LevelPkg;
import { do_post, do_upload } from "../_post.js";
import { prune_today } from "../../_util.js";

import { today } from "../_dbs.js";

export async function POST(req) {
  return await do_post(req, "today", today, prune_today, "{}");
}

export async function PUT(req) {
  return await do_upload(req, "today", today, prune_today, "{}");
}

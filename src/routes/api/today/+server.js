import LevelPkg from 'level';
const { Level } = LevelPkg;
import { do_post } from "../../_post.js";
import { prune_today } from "../../_util.js";

var today = new Level("./today");

export async function POST(req) {
  return await do_post(req, today, prune_today);
}

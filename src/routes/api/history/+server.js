import LevelPkg from 'level';
const { Level } = LevelPkg;
import { prune_history, make_history } from "../../_util.js";
import { do_post } from "../../_post.js";

var history = new Level("./history");

export async function POST(req) {
  return await do_post(req, 'history', history, prune_history, "[]");
}

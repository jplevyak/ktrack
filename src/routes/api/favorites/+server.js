import LevelPkg from "level";
const { Level } = LevelPkg;
import { do_post } from "../../_post.js";

var favorites = new Level("./favorites");

export async function POST(req) {
  return await do_post(req, 'favorites', favorites, x => x, "[]");
}

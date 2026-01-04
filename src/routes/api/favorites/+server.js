import LevelPkg from "level";
const { Level } = LevelPkg;
import { do_post, do_upload } from "../_post.js";

import { favorites } from "./_dbs.js";

export async function POST(req) {
  return await do_post(req, "favorites", favorites, (x) => x, "[]");
}

export async function PUT(req) {
  return await do_upload(req, "favorites", favorites, (x) => x, "[]");
}

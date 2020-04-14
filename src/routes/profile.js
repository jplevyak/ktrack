var levelup = require('levelup');
var leveldown = require('leveldown');
import { merge_profile, make_profile } from './_util.js';
import { do_post_internal, profile } from './_post.js';

function finalize_profile(p) {
  console.log("finalize_profile", p);
  if (p != undefined) {
    p.password = "";
    p.old_password = "";
  }
  return p;
}

export async function post(req, res) {
  console.log("post profile");
  return do_post_internal(req, res, req.body.username, profile, 'profile', merge_profile, make_profile, finalize_profile);
}

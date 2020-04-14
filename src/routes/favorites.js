var levelup = require('levelup');
var leveldown = require('leveldown');
import { merge_items, make_favorites } from './_util.js';
import { do_post } from './_post.js';

var favorites = levelup(leveldown('./favorites'));

export async function post(req, res) {
  return do_post(req, res, favorites, 'favorites', merge_items, make_favorites);
}

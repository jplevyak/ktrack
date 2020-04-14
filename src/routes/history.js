var levelup = require('levelup');
var leveldown = require('leveldown');
import { merge_history, make_history } from './_util.js';
import { do_post } from './_post.js';

var history = levelup(leveldown('./history'));

export async function post(req, res) {
  return do_post(req, res, history, 'history', merge_history, make_history);
}

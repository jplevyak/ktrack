var levelup = require('levelup')
var leveldown = require('leveldown')
import{merge_day, make_historical_day} from './_util.js';
import {do_post} from './_post.js';

var today = levelup(leveldown('./today'));

export async function post(req, res) {
  return do_post(req, res, today, 'today', merge_day, () => make_historical_day(today, 10000));
}

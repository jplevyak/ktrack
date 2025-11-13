import LevelPkg from "level";
const { Level } = LevelPkg;
import { error } from "@sveltejs/kit";
import { CollabJSON, history_prune_limit } from "./_crdt.js";

export var profile = new Level("./profile");

export async function do_post_internal(req, data, username, db, prune) {
  let db_value_str;
  try {
    db_value_str = await db.get(username);
  } catch (e) {
    // 'not-found' error indicates the key is not in the database
    if (e.code === 'LEVEL_NOT_FOUND') {
      db_value_str = undefined;
    } else {
      throw e;
    }
  }

  const server_doc_state = db_value_str ? JSON.parse(db_value_str) : null;
  
  const server_doc = CollabJSON.fromJSON(server_doc_state, { clientId: 'server' });

  if (prune) {
    server_doc.prune(prune);
  }

  const sync_response = server_doc.getSyncResponse(data);

  await db.put(username, JSON.stringify(server_doc.toJSON()));

  return new Response(JSON.stringify(sync_response));
}

export async function do_post(req, db, prune) {
  let data = await req.request.json();
  let username = data.username;
  let password = data.password;
  if (
    username == undefined ||
    !username ||
    typeof username.valueOf() !== "string"
  ) {
    console.log("bad username");
    return new Response(JSON.stringify({ err: "bad username" }));
  }
  if (
    password == undefined ||
    !password ||
    typeof password.valueOf() !== "string"
  ) {
    console.log("bad password");
    return new Response(JSON.stringify({ err: "bad password" }));
  }
  let value = await profile.get(username);
  let p = JSON.parse(value);
  if (p == undefined) {
    console.log("bad profile");
    return new Response(JSON.stringify({ err: "bad profile" }));
  }
  if (p.username != username || p.password != password) {
    console.log("incorrect password");
    return new Response(JSON.stringify({ err: "incorrect password" }));
  }
  return await do_post_internal(req, data, username, db, prune);
}

import LevelPkg from "level";
const { Level } = LevelPkg;
import { error } from "@sveltejs/kit";
import { CollabJSON } from "./_crdt.js";

export var profile = new Level("./profile");

export async function do_post_internal(req, data, username, db) {
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

  let server_doc_state;
  if (db_value_str) {
    server_doc_state = JSON.parse(db_value_str);
  }
  
  const server_doc = new CollabJSON({ clientId: 'server', id: server_doc_state ? server_doc_state.id : undefined });
  if (server_doc_state) {
    server_doc.history = server_doc_state.history;
    server_doc.dvv = new Map(Object.entries(server_doc_state.dvv));
    server_doc.history.forEach(op => server_doc.applyOp(op));
  }

  const sync_response = server_doc.getSyncResponse(data);

  const new_server_state = {
    id: server_doc.id,
    history: server_doc.history,
    dvv: Object.fromEntries(server_doc.dvv),
  };
  await db.put(username, JSON.stringify(new_server_state));

  return new Response(JSON.stringify(sync_response));
}

export async function do_post(req, db) {
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
  return await do_post_internal(req, data, username, db);
}

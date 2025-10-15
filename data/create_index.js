import { create_elasticlunr } from "../src/routes/_elasticlunr.js";
import * as fs from 'fs';

var elasticlunr = create_elasticlunr();

var index = elasticlunr(function () {
  this.addField("name");
  this.setRef("i");
  this.saveDocument(false);
});

var foods = JSON.parse(fs.readFileSync("./_foods.json"));

for (let i in foods) {
  index.addDoc({ i: i, name: foods[i].name });
}

var data = JSON.stringify(index.toJSON());
fs.writeFile("_index.json", data, function (err) {
  if (err) return console.log(err);
  console.log("Write " + data.length + " bytes");
});

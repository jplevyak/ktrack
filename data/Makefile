PYTHON = /usr/bin/python3

all:
	${PYTHON} ./convert.py
	mv _foods.json _foods.json.bak
	jq . _foods.json.bak > _foods.json
	node create_index.js

install:
	cp _foods.json ../src/routes
	cp _index.json ../src/routes

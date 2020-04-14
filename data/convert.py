import csv
import json
import sys

data = []

source = "usda-121719"

fdc_id2name = {}
name2fdc_id = {}
skip = 1
i = 0
fieldnames = ["fdc_id", "1", "name"]
with open('FoodData_Central_csv_2019-12-17/food.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        name = row["name"]
        fdc_id = row["fdc_id"]
        fdc_id2name[fdc_id] = name
        if name not in name2fdc_id:
            name2fdc_id[name] = [fdc_id]
        else:
            name2fdc_id[name].append(fdc_id)

fdc_id2k = {}
vitk = set(["1183", "1184", "1185"])
fieldnames = ["id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"];
skip = 1
i = 0
with open('FoodData_Central_csv_2019-12-17/food_nutrient.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        if not row["nutrient_id"] in vitk:
            continue
        fdc_id = row["fdc_id"]
        if not fdc_id in fdc_id2k:
            fdc_id2k[fdc_id] = row["amount"]
            continue
        else:
            v = fdc_id2k[fdc_id];
            fdc_id2k[fdc_id] = str(float(v) + float(row["amount"]))

measure = {}
fieldnames = ["id","name"]
skip = 1
i = 0
with open('FoodData_Central_csv_2019-12-17/measure_unit.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        measure[row["id"]] = row["name"]

fdc_id2portions = {}
# both portion_description and modifier should be included in the description
fieldnames = ["id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"]
skip = 1
i = 0
with open('FoodData_Central_csv_2019-12-17/food_portion.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        fdc_id = row["fdc_id"]
        portions = []
        if fdc_id in fdc_id2portions:
            portions = fdc_id2portions[fdc_id]
        portions.append(row)
        fdc_id2portions[fdc_id] = portions

# combine duplicate information
for name, l in name2fdc_id.items():
    l = [x for x in l if x in fdc_id2k]
    name2fdc_id[name] = l
    if len(l) <= 1:
        continue
    mcg = float(fdc_id2k[l[0]])
    n = 1
    for fdc_id in l[1:]:
        # skip duplicates which have portions
        if fdc_id in fdc_id2portions:
            break
        n += 1
        mcg += float(fdc_id2k[fdc_id])
    if n > 1:
        fdc_id2k[l[0]] = round(mcg / n, 3)

for fdc_id, k in fdc_id2k.items():
    if len(name2fdc_id[fdc_id2name[fdc_id]]) < 1:
        continue
    if name2fdc_id[fdc_id2name[fdc_id]][0] != fdc_id:
        continue
    if fdc_id not in fdc_id2portions:
        datum = {}
        datum["name"] = fdc_id2name[fdc_id]
        datum["mcg"] = k
        datum["notes"] = ""
        datum["unit"] = "100g"
        datum["source"] = source
        data.append(datum)
    else:
        for p in fdc_id2portions[fdc_id]:
            desc = p["amount"]
            prefix = ""
            if desc:
                prefix = " "
            if p["measure_unit_id"] != "9999":
                desc += prefix + measure[p["measure_unit_id"]]
                prefix = " "
            if p["portion_description"]:
                if p["portion_description"] == "Quantity not specified":
                    continue
                desc += prefix + p["portion_description"]
                prefix = " "
            if p["modifier"] and not p["modifier"].isdecimal():
                desc += prefix + p["modifier"]
                prefix = " "
            name = fdc_id2name[fdc_id]
            datum = {}
            datum["name"] = name + " (" + desc + ")"
            datum["mcg"] = round((float(k) * float(p["gram_weight"])) / 100.0, 3)
            datum["notes"] = p["gram_weight"] + "g"
            if p["measure_unit_id"] != "9999":
                datum["unit"] = measure[p["measure_unit_id"]]
            else:
                datum["unit"] = "unit"
            datum["source"] = source
            data.append(datum)

source = "efsa-121719"
fieldnames = ["notes", "name", "mcg", "country"]
i = 0
skip = 2
with open('Food Composition.csv', encoding="utf16") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        datum = {}
        datum["name"] = row["name"]
        datum["mcg"] = row["mcg"]
        datum["notes"] = row["notes"]
        datum["unit"] = "100g"
        datum["source"] = source
        data.append(datum)


source = "mccance-121719"
fieldnames = ["code", "name", "notes", "3", "4", "5", "6", "7" "8", "9", "10", "11", "12", "mcg", "13"]
i = 0
skip = 3
with open('McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2019.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        if not row["mcg"] or row["mcg"] == "Tr":
            continue
        datum = {}
        datum["name"] = row["name"]
        datum["mcg"] = row["mcg"]
        datum["notes"] = row["notes"]
        datum["unit"] = "100g"
        datum["source"] = source
        data.append(datum)


with open('_foods.json', 'w') as out:
    json.dump(data, out)

import csv
import json
import sys

data = []

source = "usda-04-2025"
path = 'FoodData_Central_csv_2025-04-24/'

fdc_id2name = {}
name2fdc_id = {}
skip = 1
i = 0
fieldnames = ["fdc_id", "data_type", "description"]
files = ['food.csv']
for f in files:
    with open(path + f, encoding="latin-1") as csvfile:
        reader = csv.DictReader(csvfile, fieldnames=fieldnames)
        for row in reader:
            i += 1
            if i <= skip:
                print(row)
                continue
            name = row["description"]
            fdc_id = row["fdc_id"]
            if name == "":
                print(row)
            fdc_id2name[fdc_id] = name
            if name not in name2fdc_id:
                name2fdc_id[name] = [fdc_id]
            else:
                name2fdc_id[name].append(fdc_id)

print('name2fdc_id', len(name2fdc_id))

fdc_id2k = {}
vitk = set(["1183", "1184", "1185"])
fdc_id2fiber = {}
fiber = set(["1079", "1082", "2084", "2038", "2065"])
fieldnames = ["id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"];
skip = 1
i = 0
with open(path + 'food_nutrient.csv', encoding="latin-1") as csvfile:
    reader = csv.DictReader(csvfile, fieldnames=fieldnames)
    for row in reader:
        i += 1
        if i <= skip:
            continue
        fdc_id = row["fdc_id"]
        # vitk
        if row["nutrient_id"] in vitk:
            if not fdc_id in fdc_id2k:
                fdc_id2k[fdc_id] = row["amount"]
            else:
                v = fdc_id2k[fdc_id];
                fdc_id2k[fdc_id] = str(float(v) + float(row["amount"]))
        # fiber
        if row["nutrient_id"] in fiber:
            if not fdc_id in fdc_id2fiber:
                fdc_id2fiber[fdc_id] = row["amount"]
            else:
                v = fdc_id2fiber[fdc_id];
                fdc_id2fiber[fdc_id] = str(float(v) + float(row["amount"]))

print('fdc_id2k', len(fdc_id2k))
print('fdc_id2fiber', len(fdc_id2fiber))

measure = {}
fieldnames = ["id","name"]
skip = 1
i = 0
with open(path + 'measure_unit.csv', encoding="latin-1") as csvfile:
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
with open(path + 'food_portion.csv', encoding="latin-1") as csvfile:
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
    fdc_id = l[0]
    mcg = float(fdc_id2k[fdc_id])
    n = 1
    if fdc_id in fdc_id2fiber:
        fiber_g = float(fdc_id2fiber[fdc_id])
        nfiber = 1
    else:
        nfiber = 0
    for fdc_id in l[1:]:
        # skip duplicates which have portions
        if fdc_id in fdc_id2portions:
            break
        n += 1
        mcg += float(fdc_id2k[fdc_id])
        if fdc_id in fdc_id2fiber:
            fiber_g += float(fdc_id2fiber[fdc_id])
            nfiber += 1
    else:
        nfiber = 0
    fdc_id = l[0]
    if n > 1:
        fdc_id2k[fdc_id] = round(mcg / n, 3)
    if nfiber > 1:
        fdc_id2fiber[fdc_id] = round(fiber_g / nfiber, 3)

no_reverse_name = 0
no_reverse_fdc_id = 0
for fdc_id, k in fdc_id2k.items():
    if not fdc_id in fdc_id2name or fdc_id2name[fdc_id] == "":
        continue
    name = fdc_id2name[fdc_id]
    if len(name2fdc_id[fdc_id2name[fdc_id]]) < 1:
        no_reverse_name += 1
        continue
    #if not fdc_id in name2fdc_id[fdc_id2name[fdc_id]]:
    #    no_reverse_fdc_id += 1
    #    print('fdc_id', fdc_id, 'fdc_id2name[fdc_id]', fdc_id2name[fdc_id], 'name2fdc_id[fdc_id2name[fdc_id]]', name2fdc_id[fdc_id2name[fdc_id]])
    #    continue
    if fdc_id not in fdc_id2portions:
        datum = {}
        datum["name"] = name
        datum["mcg"] = str(k)
        if fdc_id in fdc_id2fiber:
            datum["fiber"] = str(fdc_id2fiber[fdc_id])
        else:
            datum["fiber"] = ""
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
            datum = {}
            datum["name"] = name + " (" + desc + ")"
            datum["mcg"] = str(round((float(k) * float(p["gram_weight"])) / 100.0, 3))
            if fdc_id in fdc_id2fiber:
                datum["fiber"] = str(round((float(fdc_id2fiber[fdc_id]) * float(p["gram_weight"])) / 100.0, 3))
            else:
                datum["fiber"] = ""
            datum["notes"] = p["gram_weight"] + "g"
            if p["measure_unit_id"] != "9999":
                datum["unit"] = measure[p["measure_unit_id"]]
            else:
                datum["unit"] = "unit"
            datum["source"] = source
            data.append(datum)

print('no_reverse_name', no_reverse_name)
print('no_reverse_fdc_id', no_reverse_fdc_id)

def remove_duplicates(a):
    if not a:
        return 0  # Handle empty list case
    i = 0
    for j in range(1, len(a)):
        if a[j] != a[i]:
            i += 1
            a[i] = a[j]
    del a[i+1:]
    return i + 1

data = sorted(data,key=lambda x: x["name"])

print('size', len(data));
print('size without duplicates', remove_duplicates(data))
print('new size', len(data));

with open('_foods.json', 'w') as out:
    json.dump(data, out)

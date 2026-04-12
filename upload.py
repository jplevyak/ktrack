import requests
import sys
import json
import argparse

def convert_legacy_favorites(data):
    if not isinstance(data, dict) or 'value' not in data or 'items' not in data['value']:
        print("Warning: JSON structure does not match expected legacy favorites format. Uploading as is.")
        return data
    
    items = data['value']['items']
    cleaned_items = []
    for item in items:
        new_item = item.copy()
        new_item.pop('updated', None)
        new_item.pop('del', None)
        cleaned_items.append(new_item)
    return cleaned_items

def convert_legacy_history(data):
    if not isinstance(data, dict) or 'value' not in data or 'items' not in data['value']:
        print("Warning: JSON structure does not match expected legacy history format. Uploading as is.")
        return data

    history_items = data['value']['items']
    cleaned_history = []

    for day_entry in history_items:
        new_day = day_entry.copy()
        
        # Extract date components
        year = new_day.pop('year', None)
        month = new_day.pop('month', None)
        date = new_day.pop('date', None)
        day = new_day.pop('day', None)

        if year is not None and month is not None and date is not None and day is not None:
            try:
                # Assuming month is 0-indexed (common in JS legacy data), so adding 1.
                # Format: YYYY-MM-DD-d
                new_day['timestamp'] = f"{int(year)}-{int(month)+1:02d}-{int(date):02d}-{int(day)}"
            except ValueError:
                print("Warning: Invalid date fields found in history item.")

        # Clean food items
        if 'items' in new_day and isinstance(new_day['items'], list):
            cleaned_food_items = []
            for food in new_day['items']:
                new_food = food.copy()
                new_food.pop('updated', None)
                new_food.pop('del', None)
                cleaned_food_items.append(new_food)
            new_day['items'] = cleaned_food_items
        
        cleaned_history.append(new_day)

    return cleaned_history

def upload(url, username, password, filename, convert_fav=False, convert_hist=False):
    with open(filename, 'r') as f:
        data = json.load(f)
    
    if convert_fav:
        data = convert_legacy_favorites(data)
    elif convert_hist:
        data = convert_legacy_history(data)
    
    # Use HTTP Basic Authentication
    response = requests.put(url, json=data, auth=(username, password), timeout=30)
    
    if response.status_code == 200:
        print(f"Successfully uploaded {filename}")
    else:
        print(f"Failed to upload {filename}: {response.text}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload JSON to KTrack API")
    parser.add_argument("base_url", help="API endpoint URL (e.g., http://localhost:5173/api/favorites)")
    parser.add_argument("username", help="Username")
    parser.add_argument("password", help="Password")
    parser.add_argument("file_path", help="Path to JSON file")
    
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--convert-favorites", action="store_true", help="Convert from legacy favorites format")
    group.add_argument("--convert-history", action="store_true", help="Convert from legacy history format")

    args = parser.parse_args()

    upload(args.base_url, args.username, args.password, args.file_path, args.convert_favorites, args.convert_history)

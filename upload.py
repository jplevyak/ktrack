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

def upload(url, username, password, filename, convert=False):
    with open(filename, 'r') as f:
        data = json.load(f)
    
    if convert:
        data = convert_legacy_favorites(data)
    
    # Use HTTP Basic Authentication
    response = requests.put(url, json=data, auth=(username, password))
    
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
    parser.add_argument("--convert-favorites", action="store_true", help="Convert from legacy favorites format")

    args = parser.parse_args()

    upload(args.base_url, args.username, args.password, args.file_path, args.convert_favorites)

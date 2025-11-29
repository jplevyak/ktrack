import requests
import sys
import json

def upload(url, username, password, filename):
    with open(filename, 'r') as f:
        data = json.load(f)
    
    full_url = f"{url}?username={username}&password={password}"
    response = requests.put(full_url, json=data)
    
    if response.status_code == 200:
        print(f"Successfully uploaded {filename}")
    else:
        print(f"Failed to upload {filename}: {response.text}")

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Usage: python upload.py <base_url> <username> <password> <file_path>")
        print("Example: python upload.py http://localhost:5173/api/today myuser mypass today.json")
        sys.exit(1)

    base_url = sys.argv[1]
    username = sys.argv[2]
    password = sys.argv[3]
    file_path = sys.argv[4]

    upload(base_url, username, password, file_path)

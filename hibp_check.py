#!/usr/bin/env python3
"""
HaveIBeenPwned breach checker.
Reads emails from a file (one per line), checks each against HIBP API,
outputs results to CSV.

Usage:
  python3 hibp_check.py emails.txt -o breaches.csv -k YOUR_HIBP_API_KEY

Get API key at: https://haveibeenpwned.com/API/Key
"""

import requests
import csv
import time
import sys
import argparse
from pathlib import Path

HIBP_API = "https://haveibeenpwned.com/api/v3"
RATE_LIMIT_WAIT = 1.6  # HIBP free tier: ~1 req per 1.5s


def check_email(email: str, api_key: str) -> dict:
    """Check a single email against HIBP breaches API."""
    headers = {
        "hibp-api-key": api_key,
        "user-agent": "AURIX-HIBP-Checker"
    }
    try:
        r = requests.get(
            f"{HIBP_API}/breachedaccount/{email}",
            headers=headers,
            params={"truncateResponse": "false"},
            timeout=15
        )
        if r.status_code == 200:
            breaches = r.json()
            return {
                "email": email,
                "breached": "YES",
                "breach_count": len(breaches),
                "breaches": "; ".join(b["Name"] for b in breaches),
                "data_classes": "; ".join(
                    set(dc for b in breaches for dc in b.get("DataClasses", []))
                ),
                "most_recent": max(b.get("BreachDate", "") for b in breaches),
                "error": ""
            }
        elif r.status_code == 404:
            return {
                "email": email,
                "breached": "NO",
                "breach_count": 0,
                "breaches": "",
                "data_classes": "",
                "most_recent": "",
                "error": ""
            }
        elif r.status_code == 429:
            # Rate limited — wait and retry once
            retry_after = float(r.headers.get("Retry-After", RATE_LIMIT_WAIT))
            print(f"  [!] Rate limited, waiting {retry_after}s...")
            time.sleep(retry_after)
            return check_email(email, api_key)
        else:
            return {
                "email": email,
                "breached": "UNKNOWN",
                "breach_count": 0,
                "breaches": "",
                "data_classes": "",
                "most_recent": "",
                "error": f"HTTP {r.status_code}: {r.text[:200]}"
            }
    except requests.RequestException as e:
        return {
            "email": email,
            "breached": "ERROR",
            "breach_count": 0,
            "breaches": "",
            "data_classes": "",
            "most_recent": "",
            "error": str(e)[:200]
        }


def main():
    parser = argparse.ArgumentParser(description="Check emails against HaveIBeenPwned")
    parser.add_argument("input_file", help="Text file with one email per line")
    parser.add_argument("-o", "--output", default="breach_results.csv", help="Output CSV path")
    parser.add_argument("-k", "--api-key", required=True, help="HIBP API key")
    parser.add_argument("-d", "--delay", type=float, default=RATE_LIMIT_WAIT, help="Delay between requests (seconds)")
    args = parser.parse_args()

    # Read emails
    emails = [
        line.strip() for line in Path(args.input_file).read_text().splitlines()
        if line.strip() and "@" in line
    ]
    if not emails:
        print("[!] No valid emails found in input file.")
        sys.exit(1)

    print(f"[*] Loaded {len(emails)} emails from {args.input_file}")

    # Check each email
    results = []
    breached_count = 0
    for i, email in enumerate(emails, 1):
        print(f"[{i}/{len(emails)}] Checking {email}...", end=" ")
        result = check_email(email, args.api_key)
        results.append(result)
        if result["breached"] == "YES":
            breached_count += 1
            print(f"BREACHED ({result['breach_count']} breaches)")
        elif result["breached"] == "NO":
            print("Clean")
        else:
            print(f"{result['breached']} - {result['error']}")

        if i < len(emails):
            time.sleep(args.delay)

    # Write CSV
    fieldnames = ["email", "breached", "breach_count", "breaches", "data_classes", "most_recent", "error"]
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"\n{'='*50}")
    print(f"[*] Done! Results saved to {args.output}")
    print(f"[*] Total: {len(emails)} emails checked")
    print(f"[*] Breached: {breached_count}")
    print(f"[*] Clean: {len(emails) - breached_count}")


if __name__ == "__main__":
    main()

---
name: bug-hunt
description: Comprehensive CTF and security testing skill covering web exploitation (SQLi, XSS, SSTI, SSRF, JWT, prototype pollution, file upload RCE), binary exploitation (buffer overflow, ROP, heap, format string, kernel, seccomp bypass), cryptography (RSA, AES, ECC, PRNG, ZKP, lattice), reverse engineering (ELF/PE, VMs, obfuscation, WASM, game clients), forensics (disk images, memory dumps, PCAP, stego, event logs, side-channel), OSINT (social media, geolocation, DNS, public records), malware analysis (C2 traffic, packers, .NET, shellcode), AI/ML security (adversarial examples, prompt injection, model extraction), and misc challenges (jails, encodings, RF/SDR, esoteric languages, game theory). Use when the user presents a CTF challenge, security assessment, penetration test, or needs offensive security techniques. Routes to specialized sub-skills per category.
---

# Bug Hunt Skill

You're a skilled CTF player and security researcher. Your goal is to solve challenges, find vulnerabilities, and capture flags.

This skill bundles specialized techniques across all major CTF and offensive security categories. Use it for CTF competitions, security assessments, penetration testing, and capture-the-flag style challenges.

## Environment Setup

### Pre-install (recommended before competitions)

```bash
bash skills/bug-hunt/install_ctf_tools.sh all
```

Install specific tool groups only:

```bash
bash skills/bug-hunt/install_ctf_tools.sh python    # Python packages
bash skills/bug-hunt/install_ctf_tools.sh apt        # System packages
bash skills/bug-hunt/install_ctf_tools.sh go          # Go tools
bash skills/bug-hunt/install_ctf_tools.sh gems        # Ruby gems
bash skills/bug-hunt/install_ctf_tools.sh manual      # Manual installs
```

### On-demand (during challenges)

Each sub-category's SKILL.md lists only the tools needed for that category. Install as you go.

## Workflow

### Step 1: Recon

1. **Explore files** — List the challenge directory, run `file *` on everything
2. **Triage binaries** — `strings`, `xxd | head`, `binwalk`, `checksec` on binaries
3. **Fetch links** — If the challenge mentions URLs, fetch them FIRST for context
4. **Connect** — Try remote services (`nc`) to understand what they expect
5. **Read hints** — Challenge descriptions, filenames, and comments often contain clues

### Step 2: Categorize and Route

Determine the primary category, then read the matching sub-skill for deep techniques:

| Category | Sub-skill Directory | When to Use |
|----------|-------------------|-------------|
| Web | `ctf-web/` | XSS, SQLi, SSTI, SSRF, JWT, file uploads, prototype pollution |
| Pwn | `ctf-pwn/` | Buffer overflow, format string, heap, ROP, sandbox escape |
| Crypto | `ctf-crypto/` | RSA, AES, ECC, PRNG, ZKP, classical ciphers |
| Reverse | `ctf-reverse/` | Binary analysis, game clients, VMs, obfuscated code |
| Forensics | `ctf-forensics/` | Disk images, memory dumps, event logs, stego, network captures |
| OSINT | `ctf-osint/` | Social media, geolocation, DNS, public records |
| Malware | `ctf-malware/` | Obfuscated scripts, C2 traffic, PE/.NET analysis |
| Misc | `ctf-misc/` | Jails, encodings, RF/SDR, esoteric languages, constraint solving |
| AI/ML | `ctf-ai-ml/` | Model perturbation, adversarial examples, prompt injection |

To load deep techniques for a category, read the `SKILL.md` inside the matching sub-directory:

```
skills/bug-hunt/ctf-web/SKILL.md
skills/bug-hunt/ctf-pwn/SKILL.md
skills/bug-hunt/ctf-crypto/SKILL.md
skills/bug-hunt/ctf-reverse/SKILL.md
skills/bug-hunt/ctf-forensics/SKILL.md
skills/bug-hunt/ctf-osint/SKILL.md
skills/bug-hunt/ctf-malware/SKILL.md
skills/bug-hunt/ctf-misc/SKILL.md
skills/bug-hunt/ctf-ai-ml/SKILL.md
```

### Step 3: Pivot When Stuck

If your first approach doesn't work:

1. **Re-examine assumptions** — Is this really the category you think? A "web" challenge might need crypto for JWT forgery.
2. **Try a different sub-skill** — Many challenges span multiple categories.
3. **Look for what you missed** — Hidden files, alternate ports, response headers, metadata in images.
4. **Simplify** — Check for default creds, known CVEs, logic bugs before going deep.
5. **Check edge cases** — Off-by-one, race conditions, integer overflow, encoding mismatches.

**Common multi-category patterns:**
- Forensics + Crypto: encrypted data in PCAP/disk image
- Web + Reverse: WASM or obfuscated JS in web challenge
- Web + Crypto: JWT forgery, custom MAC/signature schemes
- Reverse + Pwn: reverse the binary first, then exploit the vulnerability
- Forensics + OSINT: recover data from dump, then trace via public sources
- Misc + Crypto: jail escape requires building crypto primitives
- Crypto + Geometry + Lattice: multi-layer challenges progressing from spatial reconstruction to LWE solving
- Forensics + Signal Processing: power traces / side-channel analysis

### Step 4: Generate Write-up

After solving, read `skills/bug-hunt/ctf-writeup/SKILL.md` to generate a standardized write-up.

## Flag Formats

Flags vary by CTF. Common formats:
- `flag{...}`, `FLAG{...}`, `CTF{...}`, `TEAM{...}`
- Custom prefixes: `ENO{...}`, `HTB{...}`, `picoCTF{...}`
- Sometimes just a plaintext string with no wrapper

```bash
grep -rniE '(flag|ctf|eno|htb|pico)\{' .
strings output.bin | grep -iE '\{.*\}'
```

## Quick Reference

```bash
# Recon
file *
strings binary | grep -i flag
xxd binary | head -20
binwalk -e firmware.bin
checksec --file=binary

# Connect
nc host port
echo -e "answer1\nanswer2" | nc host port
curl -v http://host:port/

# Python exploit template
python3 -c "
from pwn import *
r = remote('host', port)
r.interactive()
"
```

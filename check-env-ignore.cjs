const fs = require('fs');

let gitignore = '';
if (fs.existsSync('.gitignore')) {
  gitignore = fs.readFileSync('.gitignore', 'utf8');
} else {
  gitignore = "node_modules/\ndist/\n";
}

// Ensure .env is globally ignored
if (!gitignore.includes('.env')) {
  gitignore += "\n# Environment Variables\n.env\n.env.local\n.env.*\n";
  fs.writeFileSync('.gitignore', gitignore);
  console.log('.gitignore updated to block .env files');
} else {
  console.log('.env already in .gitignore');
}

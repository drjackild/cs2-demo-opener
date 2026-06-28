import fs from 'fs/promises';
import path from 'path';
import https from 'https';

const REPOS = {
  // ChetdeJong repo for weapons & utility
  WEAPONS_TREE: 'https://api.github.com/repos/ChetdeJong/cs2-killfeed-generator/git/trees/master?recursive=1',
  WEAPONS_BASE: 'https://raw.githubusercontent.com/ChetdeJong/cs2-killfeed-generator/master/',
};

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'CS2-Demo-Opener-Script' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
  });
}

async function downloadFile(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
      }
      fs.writeFile(dest, '').then(() => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => fs.writeFile(dest, data).then(resolve));
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching file tree from ChetdeJong/cs2-killfeed-generator...');
  const tree = await fetchJson(REPOS.WEAPONS_TREE);
  
  const svgFiles = tree.tree.filter(item => item.path.startsWith('public/weapons/') && item.path.endsWith('.svg'));
  console.log(`Found ${svgFiles.length} SVGs.`);

  const destDir = path.resolve(process.cwd(), '../public');
  
  let downloaded = 0;
  for (const file of svgFiles) {
    const url = REPOS.WEAPONS_BASE + file.path;
    const dest = path.join(destDir, file.path.replace('public/', ''));
    try {
      await downloadFile(url, dest);
      downloaded++;
      if (downloaded % 10 === 0) {
        console.log(`Downloaded ${downloaded}/${svgFiles.length}...`);
      }
    } catch (e) {
      console.error(`Failed to download ${file.path}: ${e.message}`);
    }
  }

  // Also download deathnotice modifier icons
  const modifierFiles = tree.tree.filter(item => item.path.startsWith('public/deathnotice/') && item.path.endsWith('.svg'));
  console.log(`Found ${modifierFiles.length} modifier SVGs.`);
  
  for (const file of modifierFiles) {
    const url = REPOS.WEAPONS_BASE + file.path;
    // Map public/deathnotice/icon_headshot.svg -> public/icons/headshot.svg
    let filename = path.basename(file.path);
    if (filename === 'icon_headshot.svg') filename = 'headshot.svg';
    if (filename === 'smoke_kill.svg') filename = 'smoke.svg';
    if (filename === 'blind_kill.svg') filename = 'blind.svg';
    
    const dest = path.join(destDir, 'icons', filename);
    try {
      await downloadFile(url, dest);
      console.log(`Downloaded ${filename}`);
    } catch (e) {
      console.error(`Failed to download ${file.path}: ${e.message}`);
    }
  }

  // Also download some custom UI icons like headshot, suicide from Juknum if possible, or just create them/use existing.
  // Actually, ChetdeJong's repo contains headshot.svg in public/weapons/
  
  console.log('Download complete!');
}

main().catch(console.error);

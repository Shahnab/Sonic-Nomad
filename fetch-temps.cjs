const fs = require('fs');

async function run() {
  const geojsonRes = await fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson');
  const geojson = await geojsonRes.json();
  
  const temps = {};
  const startYear = 2000;
  const endYear = 2050;
  
  for (let y = startYear; y <= endYear; y++) {
    temps[y] = {};
  }
  
  function getCentroid(feature) {
    let latSum = 0;
    let lngSum = 0;
    let count = 0;

    const extractCoords = (coords) => {
      if (typeof coords[0] === 'number') {
        lngSum += coords[0];
        latSum += coords[1];
        count++;
      } else if (Array.isArray(coords)) {
        coords.forEach(extractCoords);
      }
    };

    if (feature.geometry && feature.geometry.coordinates) {
      extractCoords(feature.geometry.coordinates);
    }

    return count > 0 ? { lat: latSum / count, lng: lngSum / count } : null;
  }

  const features = geojson.features;
  console.log(`Fetching data for ${features.length} countries...`);
  
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const iso = f.properties.ISO_A3;
    if (!iso || iso === '-99') continue;
    
    const centroid = getCentroid(f);
    if (!centroid) continue;
    
    try {
      // Fetch only 2025 data to avoid rate limits
      const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${centroid.lat}&longitude=${centroid.lng}&start_date=2025-01-01&end_date=2025-12-31&daily=temperature_2m_mean`);
      if (!res.ok) {
        console.log(`Failed for ${iso}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      
      if (data.daily && data.daily.temperature_2m_mean) {
        const dailyTemps = data.daily.temperature_2m_mean;
        
        const monthlyTemps2025 = new Array(12).fill(0);
        const monthlyCounts2025 = new Array(12).fill(0);
        
        for (let day = 0; day < dailyTemps.length; day++) {
          const dateStr = data.daily.time[day]; // "YYYY-MM-DD"
          const month = parseInt(dateStr.substring(5, 7)) - 1;
          
          if (dailyTemps[day] !== null) {
            monthlyTemps2025[month] += dailyTemps[day];
            monthlyCounts2025[month]++;
          }
        }
        
        for (let m = 0; m < 12; m++) {
          monthlyTemps2025[m] = monthlyCounts2025[m] > 0 ? Number((monthlyTemps2025[m] / monthlyCounts2025[m]).toFixed(1)) : 0;
        }
        
        // Simulate other years based on 2025 data
        // Historical: slightly cooler. Future: slightly warmer.
        for (let y = startYear; y <= endYear; y++) {
          const yearDiff = y - 2025;
          // Global warming trend: approx +0.03°C per year
          const trend = yearDiff * 0.03;
          
          const yearTemps = new Array(12);
          for (let m = 0; m < 12; m++) {
            // Add some random noise (+/- 0.5°C) for realism
            const noise = (Math.random() - 0.5) * 1.0;
            yearTemps[m] = Number((monthlyTemps2025[m] + trend + noise).toFixed(1));
          }
          temps[y][iso] = yearTemps;
        }
        
        console.log(`Fetched and simulated ${iso}`);
      }
    } catch (e) {
      console.log(`Error for ${iso}: ${e.message}`);
    }
    
    // Rate limit: 10 requests per second max, let's sleep 500ms to be safe
    await new Promise(r => setTimeout(r, 500));
  }
  
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync('src/data/temperatures.json', JSON.stringify(temps, null, 2));
  console.log('Done!');
}

run();

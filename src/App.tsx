import React, { useState, useEffect, useRef, useMemo } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { geoCentroid, geoBounds } from 'd3-geo';

const PREDEFINED_PALETTE = [
  '#E05A5A', // Coral Red       — Rock / Hard Rock
  '#5A9BE0', // Sky Blue        — Pop / Dance
  '#5ACA8A', // Mint Green      — Folk / Acoustic
  '#C97BDB', // Soft Violet     — R&B / Soul
  '#E0A84A', // Amber           — Hip Hop / Rap
  '#4AB8C4', // Teal            — Electronic / House
  '#D97060', // Burnt Sienna    — Blues / Jazz
  '#7BAD5A', // Olive Green     — Country / World
  '#6E7FDB', // Periwinkle      — Indie / Alternative
  '#DB8870', // Dusty Peach     — Latin / Reggaeton
  '#A0C45A', // Lime            — K-Pop / J-Pop
  '#C45A8A', // Rose Pink       — Pop Ballad / Classical
  '#5AB0DB', // Cerulean        — Instrumental / Ambient
  '#DBC25A', // Yellow Gold     — Gospel / Christian
  '#8A5ADB', // Indigo          — Metal / Punk
  '#5ADB9A', // Seafoam         — Afro / World
  '#DB5A70', // Crimson Pink    — Dance / EDM
  '#A0785A', // Clay Brown      — Country / Folk
  '#5A8AD9', // Cobalt          — Soundtrack / Score
  '#D4AF37', // Gold            — Everything else
  '#B8860B'  // Dark Goldenrod
];

const dynamicGenreColors: Record<string, string> = {
  'Unknown': '#333333'
};
let colorIndex = 0;

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getGenreColor(genre: string) {
  if (!genre || genre === 'Unknown') return dynamicGenreColors['Unknown'];
  
  if (dynamicGenreColors[genre]) {
    return dynamicGenreColors[genre];
  }

  const color = PREDEFINED_PALETTE[colorIndex % PREDEFINED_PALETTE.length];
  dynamicGenreColors[genre] = color;
  colorIndex++;
  
  return color;
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

export default function App() {
  const [countries, setCountries] = useState<any>({ features: [] });
  const [musicData, setMusicData] = useState<Record<string, any>>({});
  const [hoverD, setHoverD] = useState<any>();
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<any>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMouseOverUI, setIsMouseOverUI] = useState(false);
  
  // Travelling Agent State
  const [isTravelling, setIsTravelling] = useState(false);
  const [currentTravelIndex, setCurrentTravelIndex] = useState(0);
  const [travelArcsData, setTravelArcsData] = useState<any[]>([]);
  const [agentPathsData, setAgentPathsData] = useState<any[]>([]);
  const [agentRingsData, setAgentRingsData] = useState<any[]>([]);
  const [travelFlash, setTravelFlash] = useState<string | null>(null);
  const [atmosphereColor, setAtmosphereColor] = useState('#ffffff');
  const [visitedPoints, setVisitedPoints] = useState<any[]>([]);

  const globeEl = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeSize, setGlobeSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setGlobeSize({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then((res) => res.json())
      .then((data) => {
        setCountries(data);
      });
  }, []);

  useEffect(() => {
    if (!countries.features.length) return;

    let isMounted = true;
    const fetchMusicData = async () => {
      // 1. Fetch fallback data (Global/US Top 100) to populate countries without their own iTunes storefront
      let fallbackSongs: any[] = [];
      try {
        const fallbackRes = await fetch('https://itunes.apple.com/us/rss/topsongs/limit=100/json');
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (fallbackData.feed?.entry) {
            fallbackSongs = Array.isArray(fallbackData.feed.entry) ? fallbackData.feed.entry : [fallbackData.feed.entry];
          }
        }
      } catch (e) {
        console.warn("Could not fetch fallback songs");
      }

      let fallbackIndex = 0;
      const getFallbackSong = () => {
        if (fallbackSongs.length === 0) return null;
        const song = fallbackSongs[fallbackIndex % fallbackSongs.length];
        fallbackIndex++;
        return {
          title: song['im:name']?.label,
          artist: song['im:artist']?.label,
          image: song['im:image']?.[2]?.label || song['im:image']?.[0]?.label,
          preview: song.link?.find((l: any) => l.attributes?.type?.startsWith('audio'))?.attributes?.href,
          genre: song.category?.attributes?.term || 'Unknown'
        };
      };

      const newMusicData: Record<string, any> = {};
      const batchSize = 10;
      
      for (let i = 0; i < countries.features.length; i += batchSize) {
        if (!isMounted) break;
        const batch = countries.features.slice(i, i + batchSize);
        await Promise.all(batch.map(async (f: any) => {
          let iso2 = f.properties.ISO_A2;
          
          // Fix known Natural Earth ISO_A2 issues
          if (iso2 === '-99') {
            if (f.properties.NAME === 'France') iso2 = 'FR';
            else if (f.properties.NAME === 'Norway') iso2 = 'NO';
          }

          let songData = null;

          if (iso2 && iso2 !== '-99') {
            try {
              const res = await fetch(`https://itunes.apple.com/${iso2.toLowerCase()}/rss/topsongs/limit=1/json`);
              if (res.ok) {
                const data = await res.json();
                const entry = data.feed?.entry;
                if (entry) {
                  const song = Array.isArray(entry) ? entry[0] : entry;
                  songData = {
                    title: song['im:name']?.label,
                    artist: song['im:artist']?.label,
                    image: song['im:image']?.[2]?.label || song['im:image']?.[0]?.label,
                    preview: song.link?.find((l: any) => l.attributes?.type?.startsWith('audio'))?.attributes?.href,
                    genre: song.category?.attributes?.term || 'Unknown'
                  };
                }
              }
            } catch (e) {
              // Ignore errors, will use fallback
            }
          }

          // If no song data was found (either no ISO2, fetch failed, or no entry), use fallback
          if (!songData) {
            songData = getFallbackSong();
          }

          if (songData) {
            newMusicData[f.properties.ISO_A3] = songData;
          }
        }));
        
        if (isMounted) {
          setMusicData(prev => ({ ...prev, ...newMusicData }));
        }
      }
    };

    fetchMusicData();
    return () => { isMounted = false; };
  }, [countries]);

  useEffect(() => {
    if (globeEl.current) {
      globeEl.current.controls().autoRotate = autoRotate;
      globeEl.current.controls().autoRotateSpeed = 0.5;
    }
  }, [autoRotate]);

  useEffect(() => {
    setTimeout(() => {
      if (globeEl.current) {
        globeEl.current.pointOfView({ altitude: 2 });
      }
    }, 100);
  }, []);

  const wireframeMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0x222222, // subtle dark gray
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
  }, []);

  const polygonsData = useMemo(() => {
    countries.features.forEach((f: any) => {
      const iso = f.properties.ISO_A3;
      const mData = musicData[iso];
      f.properties._music = mData;
      f.properties._color = mData ? getGenreColor(mData.genre) : dynamicGenreColors['Unknown'];
      f.properties._isCountry = true;
    });
    return [...countries.features];
  }, [countries, musicData]);

  const computedRoute = useMemo(() => {
    if (!countries.features.length) return [];
    
    const countriesWithCentroids = countries.features.map((f: any) => {
      const [lng, lat] = geoCentroid(f);
      return { ...f, _centroid: { lat, lng } };
    });

    let startIdx = countriesWithCentroids.findIndex((f: any) => f.properties.ISO_A3 === 'VNM');
    if (startIdx === -1) startIdx = 0;

    const unvisited = [...countriesWithCentroids];
    const route = [];
    
    let current = unvisited.splice(startIdx, 1)[0];
    route.push(current);

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;
      
      for (let i = 0; i < unvisited.length; i++) {
        const dist = getDistance(
          current._centroid.lat, current._centroid.lng,
          unvisited[i]._centroid.lat, unvisited[i]._centroid.lng
        );
        if (dist < minDistance) {
          minDistance = dist;
          nearestIdx = i;
        }
      }
      
      current = unvisited.splice(nearestIdx, 1)[0];
      route.push(current);
    }
    
    return route;
  }, [countries]);

  const visitedIsos = useMemo(() => {
    if (!isTravelling) return new Set();
    return new Set(computedRoute.slice(0, currentTravelIndex).map((c: any) => c.properties.ISO_A3));
  }, [isTravelling, computedRoute, currentTravelIndex]);

  useEffect(() => {
    let timer: any;
    let flashTimer: any;
    if (isTravelling && computedRoute.length > 0) {
      const currentCountry = computedRoute[currentTravelIndex];
      if (!currentCountry) return;

      setSelectedCountry(currentCountry);
      setSelectedGenre(null);
      
      const [lng, lat] = [currentCountry._centroid.lng, currentCountry._centroid.lat];
      if (globeEl.current) {
        globeEl.current.pointOfView({ lat, lng, altitude: 1.6 }, 2000);
      }

      // Shift atmosphere to the current genre color
      const genre = currentCountry.properties?._music?.genre;
      const genreColor = genre ? getGenreColor(genre) : '#ffffff';
      setAtmosphereColor(genreColor);

      // Add centroid point for the landing country
      setVisitedPoints(prev => [
        ...prev.filter(p => p.iso !== currentCountry.properties.ISO_A3),
        {
          iso: currentCountry.properties.ISO_A3,
          lat: currentCountry._centroid.lat,
          lng: currentCountry._centroid.lng,
          color: genreColor,
        }
      ]);

      // Flash the arriving country
      flashTimer = setTimeout(() => setTravelFlash(null), 1800);
      setTravelFlash(currentCountry.properties.ISO_A3);

      // Trail: last 30 hops as lines (full history shown via visitedPoints dots)
      if (currentTravelIndex > 0) {
        const trailStart = Math.max(1, currentTravelIndex - 29);
        const allTrails = [];
        for (let i = trailStart; i <= currentTravelIndex - 1; i++) {
          const a = computedRoute[i - 1]?._centroid;
          const b = computedRoute[i]?._centroid;
          if (!a || !b || isNaN(a.lat) || isNaN(b.lat)) continue;
          allTrails.push({
            startLat: a.lat, startLng: a.lng,
            endLat: b.lat, endLng: b.lng,
            type: 'trail',
          });
        }
        const prev = computedRoute[currentTravelIndex - 1]?._centroid;
        const curr = currentCountry._centroid;
        if (prev && !isNaN(prev.lat) && !isNaN(curr.lat)) {
          const activeArc = { startLat: prev.lat, startLng: prev.lng, endLat: curr.lat, endLng: curr.lng };
          setTravelArcsData([
            ...allTrails,
            { ...activeArc, type: 'track' },
            { ...activeArc, type: 'comet' },
          ]);
        }
      } else {
        setTravelArcsData([]);
      }

      // Disable rings and border traces — country highlight is the signal
      setAgentRingsData([]);
      setAgentPathsData([]);

      timer = setTimeout(() => {
        if (currentTravelIndex < computedRoute.length - 1) {
          setCurrentTravelIndex(prev => prev + 1);
        } else {
          // Final country done — reset everything and return to global view
          setIsTravelling(false);
          setCurrentTravelIndex(0);
          setTravelArcsData([]);
          setAgentPathsData([]);
          setAgentRingsData([]);
          setSelectedCountry(null);
          setAtmosphereColor('#ffffff');
          setVisitedPoints([]);
          setAutoRotate(true);
          if (globeEl.current) {
            const pov = globeEl.current.pointOfView();
            globeEl.current.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: 2 }, 2000);
          }
        }
      }, 10000);
    } else if (!isTravelling) {
      if (travelArcsData.length > 0) setTravelArcsData([]);
      if (agentPathsData.length > 0) setAgentPathsData([]);
      if (agentRingsData.length > 0) setAgentRingsData([]);
      setAtmosphereColor('#ffffff');
      setVisitedPoints([]);
    }

    return () => {
      clearTimeout(timer);
      clearTimeout(flashTimer);
    };
  }, [isTravelling, currentTravelIndex, computedRoute]);

  const handleCountryClick = async (polygon: any) => {
    if (selectedCountry === polygon) return;
    
    setAutoRotate(false);
    setIsLoadingLocal(true);
    setSelectedGenre(null); // Clear genre selection when a country is clicked

    const [lng, lat] = geoCentroid(polygon);
    const bounds = geoBounds(polygon);
    
    let minLng = bounds[0][0];
    let maxLng = bounds[1][0];
    if (minLng > maxLng) maxLng += 360;
    
    const dx = maxLng - minLng;
    const dy = bounds[1][1] - bounds[0][1];
    const maxDim = Math.max(dx, dy);
    const altitude = Math.max(0.2, Math.min(maxDim / 40, 1.5)); 
    
    if (globeEl.current) {
      globeEl.current.pointOfView({ lat, lng, altitude }, 2000);
    }

    setTimeout(() => {
      setSelectedCountry(polygon);
      setIsLoadingLocal(false);
    }, 800);
  };

  const handleBackToGlobal = () => {
    setSelectedCountry(null);
    setAutoRotate(true);
    if (globeEl.current) {
      const currentPov = globeEl.current.pointOfView();
      globeEl.current.pointOfView({ lat: currentPov.lat, lng: currentPov.lng, altitude: 2 }, 2000);
    }
  };

  const handleGenreClick = (genre: string) => {
    setSelectedCountry(null);
    setSelectedGenre(prev => prev === genre ? null : genre);
    if (globeEl.current) {
      const currentPov = globeEl.current.pointOfView();
      globeEl.current.pointOfView({ lat: currentPov.lat, lng: currentPov.lng, altitude: 2 }, 2000);
    }
  };

  // Extract unique genres for legend
  const uniqueGenres = useMemo(() => {
    const genres = new Set<string>();
    Object.values(musicData).forEach(d => {
      if (d.genre) {
        genres.add(d.genre);
      }
    });
    return Array.from(genres).sort();
  }, [musicData]);

  return (
    <div 
      className="relative w-full h-screen bg-[#0a0a0a] text-zinc-100 overflow-hidden font-sans"
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
    >
      <div className="absolute inset-0 flex items-center justify-center cursor-move" ref={containerRef}>
        <Globe
          ref={globeEl}
          width={globeSize.width}
          height={globeSize.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={wireframeMaterial}
          showAtmosphere={true}
          atmosphereColor={atmosphereColor}
          atmosphereAltitude={0.18}
          globeColor="rgba(0, 0, 0, 0)"
          showGraticules={true}
          graticulesColor="rgba(255, 255, 255, 0.03)"
          polygonsData={polygonsData}
          polygonAltitude={(d) => (d === hoverD && !selectedCountry ? 0.04 : 0.01)}
          polygonCapColor={(d: any) => {
            const color = d.properties._color;
            const isGenreMatch = selectedGenre && d.properties._music?.genre === selectedGenre;
            const isCountryMatch = selectedCountry && d.properties.ISO_A3 === selectedCountry.properties.ISO_A3;

            if (isTravelling) {
              if (travelFlash === d.properties.ISO_A3) return hexToRgba(color, 1.0);
              if (isCountryMatch) return hexToRgba(color, 1.0);
              if (visitedIsos.has(d.properties.ISO_A3)) return hexToRgba(color, 0.85);
              return 'rgba(18, 18, 18, 0.65)';
            }

            if (selectedGenre) {
              return isGenreMatch ? hexToRgba(color, 1.0) : 'rgba(20, 20, 20, 0.15)';
            }
            if (selectedCountry) {
              return isCountryMatch ? hexToRgba(color, 1.0) : 'rgba(20, 20, 20, 0.25)';
            }
            return hexToRgba(color, 0.92);
          }}
          polygonSideColor={(d: any) => {
            const color = d.properties._color;
            const isGenreMatch = selectedGenre && d.properties._music?.genre === selectedGenre;
            const isCountryMatch = selectedCountry && d.properties.ISO_A3 === selectedCountry.properties.ISO_A3;

            if (isTravelling) {
              if (isCountryMatch) return hexToRgba(color, 0.9);
              if (visitedIsos.has(d.properties.ISO_A3)) return hexToRgba(color, 0.6);
              return 'rgba(18, 18, 18, 0.4)';
            }

            if (selectedGenre) {
              return isGenreMatch ? hexToRgba(color, 0.85) : 'rgba(20, 20, 20, 0.05)';
            }
            if (selectedCountry) {
              return isCountryMatch ? hexToRgba(color, 0.8) : 'rgba(20, 20, 20, 0.1)';
            }
            return hexToRgba(color, 0.65);
          }}
          polygonStrokeColor={(d: any) => {
            const color = d.properties._color;
            const isGenreMatch = selectedGenre && d.properties._music?.genre === selectedGenre;
            const isCountryMatch = selectedCountry && d.properties.ISO_A3 === selectedCountry.properties.ISO_A3;

            if (isTravelling) {
              if (isCountryMatch) return 'rgba(255,255,255,0.9)';
              if (visitedIsos.has(d.properties.ISO_A3)) return hexToRgba(color, 0.4);
              return 'rgba(40, 40, 40, 0.3)';
            }

            if (selectedGenre) {
              return isGenreMatch ? color : 'rgba(50, 50, 50, 0.2)';
            }
            if (selectedCountry) {
              return isCountryMatch ? color : 'rgba(50, 50, 50, 0.2)';
            }
            return color;
          }}
          onPolygonHover={setHoverD}
          onPolygonClick={handleCountryClick}
          polygonsTransitionDuration={1000}
          arcsData={travelArcsData}
          arcStartLat={(d: any) => d.startLat}
          arcStartLng={(d: any) => d.startLng}
          arcEndLat={(d: any) => d.endLat}
          arcEndLng={(d: any) => d.endLng}
          arcColor={(d: any) => {
            if (d.type === 'comet') return ['rgba(255,255,255,0.0)', 'rgba(255,255,255,1.0)'];
            if (d.type === 'track') return 'rgba(255,255,255,0.6)';
            return 'rgba(255,255,255,0.35)';
          }}
          arcDashLength={(d: any) => d.type === 'comet' ? 0.08 : 1}
          arcDashGap={(d: any) => d.type === 'comet' ? 0.92 : 0}
          arcDashAnimateTime={(d: any) => d.type === 'comet' ? 800 : 0}
          arcStroke={(d: any) => {
            if (d.type === 'comet') return 1.5;
            if (d.type === 'track') return 0.9;
            return 0.5;
          }}
          arcAltitudeAutoScale={(d: any) => d.type === 'trail' ? 0.25 : 0.35}
          pathsData={[]}
          pathPoints="path"
          pathPointLat={(p: any) => p[0]}
          pathPointLng={(p: any) => p[1]}
          pathPointAlt={(p: any) => p[2]}
          pathColor={(d: any) => d.color}
          pathDashLength={0.06}
          pathDashGap={0.35}
          pathDashAnimateTime={1600}
          pathStroke={2}
          ringsData={[]}
          ringLat={(d: any) => d.lat}
          ringLng={(d: any) => d.lng}
          ringColor={(d: any) => d.color}
          ringMaxRadius={(d: any) => d.maxRadius ?? 8}
          ringPropagationSpeed={(d: any) => d.speed ?? 2}
          ringRepeatPeriod={(d: any) => d.repeatPeriod ?? 800}
          labelsData={[]}
          labelLat={(d: any) => d.lat}
          labelLng={(d: any) => d.lng}
          labelText={(d: any) => d.text}
          labelSize={0.35}
          labelDotRadius={0.3}
          labelColor={() => 'rgba(200, 40, 40, 0.85)'}
          labelAltitude={0.05}
          pointsData={isTravelling ? visitedPoints : []}
          pointLat={(d: any) => d.lat}
          pointLng={(d: any) => d.lng}
          pointColor={(d: any) => d.color}
          pointAltitude={0.005}
          pointRadius={0.22}
          pointsMerge={false}
        />
      </div>

      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 sm:p-8 overflow-hidden z-10">
        <div className="flex flex-col w-full relative gap-4">
          {/* Title — always visible */}
          <div 
            className="pointer-events-auto"
            onMouseEnter={() => setIsMouseOverUI(true)}
            onMouseLeave={() => setIsMouseOverUI(false)}
          >
            <h1 className="font-sans text-2xl sm:text-4xl font-light tracking-wide text-white/90">
              Sonic Nomad
            </h1>
            <p className="text-white/40 text-xs sm:text-sm mt-1 font-mono tracking-widest uppercase">
              An agent roaming the globe · one song per country
            </p>
          </div>

          {/* Player panel — sits below title */}
          <div 
            className={`w-full sm:w-auto transition-all duration-500 ${selectedCountry ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
            onMouseEnter={() => setIsMouseOverUI(true)}
            onMouseLeave={() => setIsMouseOverUI(false)}
          >
            <div className="bg-black/40 backdrop-blur-xl p-4 sm:p-6 rounded-2xl border border-white/10 shadow-2xl max-w-sm">
              <h2 className="text-xl sm:text-2xl font-light text-white/90 mb-1 font-sans">
                {selectedCountry?.properties?.ADMIN || 'Region Select'}
              </h2>
              <p className="text-white/40 text-xs sm:text-sm font-mono uppercase tracking-widest mb-4 sm:mb-6">Active Signal</p>
              
              {selectedCountry?.properties?._music ? (
                <div className="flex flex-col gap-4 mb-6">
                  <div className="flex items-center gap-4">
                    {selectedCountry.properties._music.image && (
                      <img 
                        src={selectedCountry.properties._music.image} 
                        alt="Album Art" 
                        className="w-16 h-16 rounded-xl border border-white/10 shadow-lg"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white/90 truncate font-sans">{selectedCountry.properties._music.title}</p>
                      <p className="text-white/60 text-sm truncate font-sans">{selectedCountry.properties._music.artist}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getGenreColor(selectedCountry.properties._music.genre) }}></div>
                        <p className="text-white/50 text-xs font-mono truncate uppercase">{selectedCountry.properties._music.genre}</p>
                      </div>
                    </div>
                  </div>
                  
                  {selectedCountry.properties._music.preview && (
                    <audio 
                      autoPlay={isTravelling}
                      controls 
                      src={selectedCountry.properties._music.preview} 
                      className="w-full h-8 opacity-80"
                    />
                  )}
                </div>
              ) : (
                <p className="text-white/30 text-sm mb-6 font-sans italic">No signal detected.</p>
              )}

              <button 
                onClick={handleBackToGlobal}
                className="flex items-center gap-2 text-xs sm:text-sm text-black bg-white/90 hover:bg-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-full transition-colors font-sans font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                Back to Global
              </button>
            </div>
          </div>

          {isLoadingLocal && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-20 pointer-events-none z-50">
              <div className="bg-black/40 backdrop-blur-xl px-6 py-3 rounded-full border border-white/10 flex items-center gap-3 shadow-2xl">
                <div className="w-4 h-4 border-2 border-white/20 border-t-white/90 rounded-full animate-spin"></div>
                <span className="text-white/90 text-sm font-mono uppercase tracking-widest">Establishing Link...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Section: Vertical Legend */}
        <div 
          className="absolute right-4 sm:right-8 top-24 bottom-32 pointer-events-auto flex flex-col justify-end z-20"
          onMouseEnter={() => setIsMouseOverUI(true)}
          onMouseLeave={() => setIsMouseOverUI(false)}
        >
          <div className="bg-black/40 backdrop-blur-xl p-4 sm:p-5 rounded-2xl border border-white/10 w-[160px] sm:w-[200px] flex flex-col max-h-full">
            <div className="flex items-center gap-1 mb-3 shrink-0">
              <span className="text-[10px] sm:text-xs text-white/40 font-mono uppercase tracking-widest">Detected Signatures</span>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              {uniqueGenres.length > 0 ? uniqueGenres.map((genre) => (
                <button 
                  key={genre} 
                  onClick={() => handleGenreClick(genre)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-300 text-left ${selectedGenre === genre ? 'bg-white/10 shadow-[0_0_10px_rgba(255,255,255,0.1)]' : 'hover:bg-white/5'}`}
                >
                  <div
                    className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: dynamicGenreColors[genre] || dynamicGenreColors['Unknown'] }}
                  />
                  <span className={`text-[9px] sm:text-[10px] font-mono uppercase transition-colors truncate ${selectedGenre === genre ? 'text-white/90' : 'text-white/60'}`}>{genre}</span>
                </button>
              )) : (
                <span className="text-[8px] sm:text-[10px] text-white/30 font-mono uppercase animate-pulse">Scanning frequencies...</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 w-full pr-10 sm:pr-0 mt-auto">
          <div 
            className="pointer-events-auto flex flex-col gap-2 sm:gap-3"
            onMouseEnter={() => setIsMouseOverUI(true)}
            onMouseLeave={() => setIsMouseOverUI(false)}
          >
            <div className="text-[8px] sm:text-[10px] text-white/30 font-mono uppercase tracking-widest pl-1">
              SYS.SRC: Apple Music RSS
            </div>
            <div className="flex items-center gap-2 sm:gap-3 bg-black/40 backdrop-blur-xl px-3 py-2 rounded-full border border-white/10 w-fit">
              <span className="text-[8px] sm:text-[10px] text-white/40 font-mono uppercase tracking-widest">Agent_Travel</span>
              <button
                onClick={() => {
                  if (isTravelling) {
                    setIsTravelling(false);
                  } else {
                    setAutoRotate(false);
                    setIsTravelling(true);
                    setCurrentTravelIndex(0);
                  }
                }}
                className={`w-7 sm:w-8 h-3.5 sm:h-4 rounded-full transition-colors duration-300 relative ${isTravelling ? 'bg-white/30' : 'bg-white/5'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full bg-white/90 transition-transform duration-300 ${isTravelling ? 'translate-x-3.5 sm:translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          <div 
            className="pointer-events-auto flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-end w-full sm:w-auto gap-4"
            onMouseEnter={() => setIsMouseOverUI(true)}
            onMouseLeave={() => setIsMouseOverUI(false)}
          >
            <div className="flex items-center gap-2 sm:gap-3 bg-black/40 backdrop-blur-xl px-3 py-2 rounded-full border border-white/10">
              <span className="text-[8px] sm:text-[10px] text-white/40 font-mono uppercase tracking-widest">Auto_Spin</span>
              <button
                onClick={() => setAutoRotate(!autoRotate)}
                className={`w-7 sm:w-8 h-3.5 sm:h-4 rounded-full transition-colors duration-300 relative ${autoRotate ? 'bg-white/30' : 'bg-white/5'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full bg-white/90 transition-transform duration-300 ${autoRotate ? 'translate-x-3.5 sm:translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            <p className="font-sans font-bold text-white/80 text-xs sm:text-sm">
              Concept by Shahnab
            </p>
          </div>
        </div>
      </div>

      {isTravelling && selectedCountry && computedRoute.length > 0 && currentTravelIndex < computedRoute.length && (
        <div className="absolute bottom-24 left-4 sm:left-8 pointer-events-none z-30 flex flex-col gap-3">
          {/* Equalizer bars */}
          <div className="flex items-end gap-[3px]">
            {[0.4,0.7,1.0,0.6,0.9,0.5,0.8,0.45,0.75,0.55,0.85,0.65].map((base, i) => (
              <div
                key={i}
                className="w-[3px] rounded-full"
                style={{
                  height: `${10 + base * 18}px`,
                  backgroundColor: atmosphereColor,
                  opacity: 0.65,
                  animation: `eq-bar ${0.5 + base * 0.6}s ease-in-out ${i * 0.07}s infinite alternate`,
                  transformOrigin: 'bottom',
                }}
              />
            ))}
          </div>
          {/* Travel info */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-white/50 animate-pulse" />
              <span className="text-[9px] font-mono text-white/35 tracking-[0.25em] uppercase">Travelling</span>
            </div>
            <span className="text-white/90 font-sans text-sm font-light tracking-wide drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
              {computedRoute[currentTravelIndex]?.properties?.ADMIN || computedRoute[currentTravelIndex]?.properties?.NAME}
            </span>
            <div className="flex items-center gap-2 w-40">
              <div className="flex-1 h-0.5 bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/70 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${((currentTravelIndex + 1) / computedRoute.length) * 100}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-white/35 shrink-0 tabular-nums">{currentTravelIndex + 1}/{computedRoute.length}</span>
            </div>
          </div>
        </div>
      )}

      {hoverD && !isMouseOverUI && (
        <div
          className="absolute pointer-events-none bg-black/60 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-2xl shadow-2xl z-50 min-w-[200px]"
          style={{
            left: mousePos.x,
            top: mousePos.y,
            transform: 'translate(-50%, -120%)',
            transition: 'left 0.05s linear, top 0.05s linear'
          }}
        >
          <p className="font-sans font-medium text-lg text-white/90 mb-1">
            {hoverD.properties.ADMIN || hoverD.properties.NAME}
          </p>
          {hoverD.properties._music ? (
            <div className="flex flex-col gap-1">
              <p className="text-white/80 text-sm font-sans truncate">{hoverD.properties._music.title}</p>
              <p className="text-white/50 text-xs font-sans truncate">{hoverD.properties._music.artist}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hoverD.properties._color }}></div>
                <p className="text-white/60 font-mono text-[10px] uppercase tracking-widest truncate">
                  {hoverD.properties._music.genre}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-white/30 text-xs font-sans italic">No Signal</p>
          )}
        </div>
      )}
    </div>
  );
}
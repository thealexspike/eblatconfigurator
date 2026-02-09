import React, { useState, useEffect, createContext, useContext, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createClient } from '@supabase/supabase-js';

// ============================================
// GLOBAL HELPER FUNCTIONS
// ============================================

// Convert HSL to hex for Three.js
const hslToHex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return parseInt(`${f(0)}${f(8)}${f(4)}`, 16);
};

// Get consistent color for a group (used in sidebar, footer, and 3D)
// Avoids red hues (0-30 and 330-360) as red is reserved for error states
const getGroupColor = (groupId) => {
  if (!groupId) return null;
  let hue = parseInt(groupId, 36) % 300; // 0-299
  hue = hue + 30; // Shift to 30-329, avoiding red (0-30 and 330-360)
  return {
    hsl: `hsl(${hue}, 60%, 50%)`,
    hex: hslToHex(hue, 60, 50),
    hue
  };
};

// ============================================
// CUTOUT (DECUPAJE) PRESETS & FUNCTIONS
// ============================================

const CUTOUT_PRESETS = {
  // BLAT ONLY
  'sink-single':     { type: 'rectangle', width: 50, height: 40, cornerRadius: 5, name: 'Chiuvetă simplă', icon: '🚰', forTypes: ['island'] },
  'sink-double':     { type: 'rectangle', width: 80, height: 45, cornerRadius: 5, name: 'Chiuvetă dublă', icon: '🚰', forTypes: ['island'] },
  'sink-round':      { type: 'circle', radius: 22, name: 'Chiuvetă rotundă', icon: '🚰', forTypes: ['island'] },
  'tap-32':          { type: 'circle', radius: 1.6, name: 'Baterie Ø32mm', icon: '🚿', forTypes: ['island'] },
  'hob-60':          { type: 'rectangle', width: 56, height: 49, cornerRadius: 3, name: 'Plită 60cm', icon: '🔥', forTypes: ['island'] },
  'hob-70':          { type: 'rectangle', width: 65, height: 49, cornerRadius: 3, name: 'Plită 70cm', icon: '🔥', forTypes: ['island'] },
  'hob-80':          { type: 'rectangle', width: 75, height: 49, cornerRadius: 3, name: 'Plită 80cm', icon: '🔥', forTypes: ['island'] },
  'hob-90':          { type: 'rectangle', width: 85, height: 49, cornerRadius: 3, name: 'Plită 90cm', icon: '🔥', forTypes: ['island'] },
  
  // BLAT + CONTRABLAT
  'outlet-single':   { type: 'rectangle', width: 8, height: 8, cornerRadius: 1, name: 'Priză simplă', icon: '🔌', forTypes: ['island', 'backsplash'] },
  'outlet-double':   { type: 'rectangle', width: 15, height: 8, cornerRadius: 1, name: 'Priză dublă', icon: '🔌', forTypes: ['island', 'backsplash'] },
  'outlet-triple':   { type: 'rectangle', width: 22, height: 8, cornerRadius: 1, name: 'Priză triplă', icon: '🔌', forTypes: ['island', 'backsplash'] },
  'hole-3':          { type: 'circle', radius: 1.5, name: 'Gaură Ø3cm', icon: '⭕', forTypes: ['island', 'backsplash'] },
  'hole-5':          { type: 'circle', radius: 2.5, name: 'Gaură Ø5cm', icon: '⭕', forTypes: ['island', 'backsplash'] },
  'hole-8':          { type: 'circle', radius: 4, name: 'Gaură Ø8cm', icon: '⭕', forTypes: ['island', 'backsplash'] },
  'custom-rect':     { type: 'rectangle', width: 20, height: 20, cornerRadius: 0, name: 'Dreptunghi custom', icon: '⬜', forTypes: ['island', 'backsplash'] },
  'custom-circle':   { type: 'circle', radius: 10, name: 'Cerc custom', icon: '⭕', forTypes: ['island', 'backsplash'] },
};

// Transform user input (cota de la stânga/față) to internal center coordinates
// Pentru DREPTUNGHI: cota e până la colțul stânga-față
// Pentru CERC: cota e până la centru (ax)
function cutoutUserInputToCenter(cotaStanga, cotaFata, cutout, pieceLength, pieceDepth) {
  if (cutout.type === 'circle') {
    // Cerc: cota e direct la centru
    return {
      x: cotaStanga - pieceLength / 2,
      z: cotaFata - pieceDepth / 2
    };
  } else {
    // Dreptunghi: cota e la colțul stânga-față, centrul = colț + jumătate dimensiuni
    const centerFromOriginX = cotaStanga + (cutout.width || 0) / 2;
    const centerFromOriginZ = cotaFata + (cutout.height || 0) / 2;
    return {
      x: centerFromOriginX - pieceLength / 2,
      z: centerFromOriginZ - pieceDepth / 2
    };
  }
}

// Transform internal center to user-friendly input values
function cutoutCenterToUserInput(cutout, pieceLength, pieceDepth) {
  const centerFromOriginX = cutout.center.x + pieceLength / 2;
  const centerFromOriginZ = cutout.center.z + pieceDepth / 2;
  
  if (cutout.type === 'circle') {
    // Cerc: returnăm direct centrul
    return {
      cotaStanga: centerFromOriginX,
      cotaFata: centerFromOriginZ
    };
  } else {
    // Dreptunghi: returnăm colțul stânga-față
    return {
      cotaStanga: centerFromOriginX - (cutout.width || 0) / 2,
      cotaFata: centerFromOriginZ - (cutout.height || 0) / 2
    };
  }
}

// Get bounding box of cutout in piece-local coordinates (cm)
function getCutoutBoundingBox(cutout) {
  if (cutout.type === 'circle') {
    const r = cutout.radius || 0;
    return {
      left: cutout.center.x - r,
      right: cutout.center.x + r,
      front: cutout.center.z - r,
      back: cutout.center.z + r,
      width: r * 2,
      height: r * 2
    };
  }
  const w = cutout.width || 0;
  const h = cutout.height || 0;
  return {
    left: cutout.center.x - w / 2,
    right: cutout.center.x + w / 2,
    front: cutout.center.z - h / 2,
    back: cutout.center.z + h / 2,
    width: w,
    height: h
  };
}

// Calculate distances from cutout to piece edges
function getCutoutEdgeDistances(cutout, pieceLength, pieceDepth) {
  const bbox = getCutoutBoundingBox(cutout);
  return {
    stanga: pieceLength / 2 + bbox.left,
    dreapta: pieceLength / 2 - bbox.right,
    fata: pieceDepth / 2 + bbox.front,
    spate: pieceDepth / 2 - bbox.back
  };
}

// Check if two cutouts overlap
function checkCutoutsOverlap(a, b) {
  // Circle vs Circle
  if (a.type === 'circle' && b.type === 'circle') {
    const dx = a.center.x - b.center.x;
    const dz = a.center.z - b.center.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = (a.radius || 0) + (b.radius || 0);
    return {
      overlaps: dist < minDist,
      distance: dist - minDist
    };
  }
  
  // Circle vs Rectangle
  if (a.type === 'circle' || b.type === 'circle') {
    const circle = a.type === 'circle' ? a : b;
    const rect = a.type === 'circle' ? b : a;
    const bboxRect = getCutoutBoundingBox(rect);
    
    // Find closest point on rect to circle center
    const closestX = Math.max(bboxRect.left, Math.min(circle.center.x, bboxRect.right));
    const closestZ = Math.max(bboxRect.front, Math.min(circle.center.z, bboxRect.back));
    
    const dx = circle.center.x - closestX;
    const dz = circle.center.z - closestZ;
    const distToEdge = Math.sqrt(dx * dx + dz * dz);
    
    return {
      overlaps: distToEdge < (circle.radius || 0),
      distance: distToEdge - (circle.radius || 0)
    };
  }
  
  // Rectangle vs Rectangle (AABB)
  const bboxA = getCutoutBoundingBox(a);
  const bboxB = getCutoutBoundingBox(b);
  
  const overlapX = Math.max(0, Math.min(bboxA.right, bboxB.right) - Math.max(bboxA.left, bboxB.left));
  const overlapZ = Math.max(0, Math.min(bboxA.back, bboxB.back) - Math.max(bboxA.front, bboxB.front));
  
  if (overlapX > 0 && overlapZ > 0) {
    return { overlaps: true, distance: -Math.min(overlapX, overlapZ) };
  }
  
  const gapX = Math.max(bboxA.left - bboxB.right, bboxB.left - bboxA.right, 0);
  const gapZ = Math.max(bboxA.front - bboxB.back, bboxB.front - bboxA.back, 0);
  const distance = Math.sqrt(gapX * gapX + gapZ * gapZ);
  
  return { overlaps: false, distance };
}

// Validate a cutout against piece dimensions and other cutouts
function validateCutout(cutout, pieceLength, pieceDepth, allCutouts) {
  const errors = [];
  const warnings = [];
  const MIN_EDGE = 5; // cm
  const MIN_BETWEEN = 5; // cm
  
  const edges = getCutoutEdgeDistances(cutout, pieceLength, pieceDepth);
  
  // ERRORS: Cutout outside piece
  if (edges.stanga < 0) errors.push('Decupajul iese din marginea stângă');
  if (edges.dreapta < 0) errors.push('Decupajul iese din marginea dreaptă');
  if (edges.fata < 0) errors.push('Decupajul iese din marginea din față');
  if (edges.spate < 0) errors.push('Decupajul iese din marginea din spate');
  
  // WARNINGS: Too close to edge
  if (edges.stanga >= 0 && edges.stanga < MIN_EDGE) 
    warnings.push(`Distanță ${edges.stanga.toFixed(1)}cm de stânga (min: ${MIN_EDGE}cm)`);
  if (edges.dreapta >= 0 && edges.dreapta < MIN_EDGE) 
    warnings.push(`Distanță ${edges.dreapta.toFixed(1)}cm de dreapta (min: ${MIN_EDGE}cm)`);
  if (edges.fata >= 0 && edges.fata < MIN_EDGE) 
    warnings.push(`Distanță ${edges.fata.toFixed(1)}cm de față (min: ${MIN_EDGE}cm)`);
  if (edges.spate >= 0 && edges.spate < MIN_EDGE) 
    warnings.push(`Distanță ${edges.spate.toFixed(1)}cm de spate (min: ${MIN_EDGE}cm)`);
  
  // ERRORS: Overlap with other cutouts
  // WARNINGS: Too close to other cutouts
  allCutouts.forEach(other => {
    if (other.id === cutout.id) return;
    const overlap = checkCutoutsOverlap(cutout, other);
    if (overlap.overlaps) {
      errors.push(`Suprapunere cu "${other.name}"`);
    } else if (overlap.distance < MIN_BETWEEN) {
      warnings.push(`Distanță ${overlap.distance.toFixed(1)}cm de "${other.name}" (min: ${MIN_BETWEEN}cm)`);
    }
  });
  
  // ERRORS: Invalid dimensions
  if (cutout.type === 'circle') {
    if (!cutout.radius || cutout.radius < 0.5) errors.push('Raza minimă este 0.5cm');
    if (cutout.radius > 80) errors.push('Raza maximă este 80cm');
  } else {
    if (!cutout.width || cutout.width < 1) errors.push('Lățimea minimă este 1cm');
    if (!cutout.height || cutout.height < 1) errors.push('Adâncimea minimă este 1cm');
    if (cutout.width > 320) errors.push('Lățimea maximă este 320cm');
    if (cutout.height > 160) errors.push('Adâncimea maximă este 160cm');
    if (cutout.cornerRadius > 30) errors.push('Raza de rotunjire maximă este 30cm');
  }
  
  return { valid: errors.length === 0, errors, warnings, edges };
}

// Convert induction system to cutout-like object for overlap checking
function inductionToCutoutLike(sys) {
  return {
    id: sys.id,
    name: sys.name,
    type: sys.type,
    center: { x: sys.centerX || 0, z: sys.centerZ || 0 },
    width: sys.width || null,
    height: sys.height || null,
    radius: sys.radius || null,
    cornerRadius: 0,
  };
}

// Validate an induction system against piece dimensions, other induction systems, and cutouts
function validateInduction(sys, pieceLength, pieceDepth, allInductions, allCutouts, preset) {
  const errors = [];
  const warnings = [];
  const minFront = preset?.minFront || 3;
  const minBack = preset?.minBack || 3;
  const MIN_BETWEEN = 3; // cm between induction systems

  // Convert to cutout-like for overlap checks
  const sysLike = inductionToCutoutLike(sys);
  const edges = getCutoutEdgeDistances(sysLike, pieceLength, pieceDepth);

  // ERRORS: Outside piece
  if (edges.stanga < 0) errors.push('Sistemul iese din marginea stângă');
  if (edges.dreapta < 0) errors.push('Sistemul iese din marginea dreaptă');
  if (edges.fata < 0) errors.push('Sistemul iese din marginea din față');
  if (edges.spate < 0) errors.push('Sistemul iese din marginea din spate');

  // WARNINGS: Too close to edge (using preset min margins)
  if (edges.fata >= 0 && edges.fata < minFront)
    warnings.push(`Distanță ${edges.fata.toFixed(1)}cm de față (min: ${minFront}cm)`);
  if (edges.spate >= 0 && edges.spate < minBack)
    warnings.push(`Distanță ${edges.spate.toFixed(1)}cm de spate (min: ${minBack}cm)`);

  // Check overlap with other induction systems
  allInductions.forEach(other => {
    if (other.id === sys.id) return;
    const otherLike = inductionToCutoutLike(other);
    const overlap = checkCutoutsOverlap(sysLike, otherLike);
    if (overlap.overlaps) {
      errors.push(`Suprapunere cu "${other.name}"`);
    } else if (overlap.distance < MIN_BETWEEN) {
      warnings.push(`Distanță ${overlap.distance.toFixed(1)}cm de "${other.name}" (min: ${MIN_BETWEEN}cm)`);
    }
  });

  // Check overlap with cutouts
  (allCutouts || []).forEach(cutout => {
    const overlap = checkCutoutsOverlap(sysLike, cutout);
    if (overlap.overlaps) {
      errors.push(`Suprapunere cu decupajul "${cutout.name}"`);
    } else if (overlap.distance < MIN_BETWEEN) {
      warnings.push(`Distanță ${overlap.distance.toFixed(1)}cm de decupajul "${cutout.name}" (min: ${MIN_BETWEEN}cm)`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

// Create a new cutout from preset, positioned at piece center
function createCutoutFromPreset(presetId, pieceLength, pieceDepth) {
  const preset = CUTOUT_PRESETS[presetId];
  if (!preset) return null;
  
  // Default position: center of piece (for user: length/2, depth/2)
  // Internal center: (0, 0)
  const cutout = {
    id: Math.random().toString(36).substr(2, 9),
    type: preset.type,
    center: { x: 0, z: 0 },
    width: preset.width || null,
    height: preset.height || null,
    radius: preset.radius || null,
    cornerRadius: preset.cornerRadius || 0,
    name: preset.name,
    preset: presetId
  };
  
  return cutout;
}

/**
 * Creates a THREE.js geometry for a slab/backsplash with cutouts
 * Uses Shape + ExtrudeGeometry for pieces with cutouts, BoxGeometry for simple pieces
 * 
 * @param {number} widthCm - Width in cm (length of piece)
 * @param {number} heightCm - Height in cm (depth for blat, height for backsplash)
 * @param {number} thicknessMm - Thickness in mm
 * @param {Array} cutouts - Array of cutout objects
 * @param {boolean} isBacksplash - If true, geometry is vertical (Y-up), else horizontal (Y=thickness)
 * @returns {THREE.BufferGeometry}
 */
function createGeometryWithCutouts(widthCm, heightCm, thicknessMm, cutouts = [], isBacksplash = false) {
  const width = widthCm / 100;   // meters
  const height = heightCm / 100; // meters
  const thickness = thicknessMm / 1000; // meters
  
  // If no cutouts, use simple BoxGeometry
  if (!cutouts || cutouts.length === 0) {
    if (isBacksplash) {
      return new THREE.BoxGeometry(width, height, thickness);
    } else {
      return new THREE.BoxGeometry(width, thickness, height);
    }
  }
  
  // Create main shape (rectangle centered at origin)
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const halfH = height / 2;
  
  // Main rectangle path (counter-clockwise)
  shape.moveTo(-halfW, -halfH);
  shape.lineTo(halfW, -halfH);
  shape.lineTo(halfW, halfH);
  shape.lineTo(-halfW, halfH);
  shape.lineTo(-halfW, -halfH);
  
  // Add cutouts as holes
  cutouts.forEach(cutout => {
    const hole = new THREE.Path();
    
    // Convert center from cm to meters
    const cx = cutout.center.x / 100;
    const cz = cutout.center.z / 100;
    
    if (cutout.type === 'circle') {
      const r = (cutout.radius || 0) / 100;
      // Circle hole (clockwise for hole)
      const segments = 32;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = cx + r * Math.cos(angle);
        const y = cz + r * Math.sin(angle);
        if (i === 0) {
          hole.moveTo(x, y);
        } else {
          hole.lineTo(x, y);
        }
      }
    } else {
      // Rectangle hole (with optional corner radius)
      const w = (cutout.width || 0) / 100 / 2;
      const h = (cutout.height || 0) / 100 / 2;
      const r = Math.min((cutout.cornerRadius || 0) / 100, w, h);
      
      if (r > 0.001) {
        // Rounded rectangle (clockwise for hole)
        hole.moveTo(cx - w + r, cz - h);
        hole.lineTo(cx + w - r, cz - h);
        hole.quadraticCurveTo(cx + w, cz - h, cx + w, cz - h + r);
        hole.lineTo(cx + w, cz + h - r);
        hole.quadraticCurveTo(cx + w, cz + h, cx + w - r, cz + h);
        hole.lineTo(cx - w + r, cz + h);
        hole.quadraticCurveTo(cx - w, cz + h, cx - w, cz + h - r);
        hole.lineTo(cx - w, cz - h + r);
        hole.quadraticCurveTo(cx - w, cz - h, cx - w + r, cz - h);
      } else {
        // Simple rectangle (clockwise for hole)
        hole.moveTo(cx - w, cz - h);
        hole.lineTo(cx + w, cz - h);
        hole.lineTo(cx + w, cz + h);
        hole.lineTo(cx - w, cz + h);
        hole.lineTo(cx - w, cz - h);
      }
    }
    
    shape.holes.push(hole);
  });
  
  // Extrude the shape
  const extrudeSettings = {
    depth: thickness,
    bevelEnabled: false
  };
  
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  
  // ExtrudeGeometry creates shape on XY plane, extruded from Z=0 to Z=depth
  // We need to center it first, then rotate/position based on orientation
  
  // Center the extrusion on Z axis (from -thickness/2 to +thickness/2)
  geometry.translate(0, 0, -thickness / 2);
  
  // Rotate and position geometry based on orientation
  if (isBacksplash) {
    // Backsplash: vertical panel on XY plane, thickness on Z
    // Already correct after centering above
  } else {
    // Slab: horizontal panel on XZ plane, thickness on Y
    // Rotate 90° on X axis to lay flat
    // After rotation: Z becomes -Y, so geometry extends from -thickness/2 to +thickness/2 on Y
    geometry.rotateX(-Math.PI / 2);
  }
  
  return geometry;
}

/**
 * Get cutout position in mesh-local 3D coordinates
 * Matches the coordinate transformation used in createGeometryWithCutouts
 */
function getCutout3DPosition(cutout, thicknessMm, isBacksplash) {
  const thickness = thicknessMm / 1000; // meters
  const cx = cutout.center.x / 100; // meters - same as boolean
  const cz = cutout.center.z / 100; // meters - same as boolean
  
  if (isBacksplash) {
    // Backsplash: XY plane, cutout at (cx, cz) on front face
    return { x: cx, y: cz, z: thickness / 2 + 0.002 };
  } else {
    // Slab: after rotateX(-PI/2), shape Y becomes -Z in mesh space
    // So cutout at (cx, cz) in shape becomes (cx, thickness, -cz) in mesh
    return { x: cx, y: thickness + 0.002, z: -cz };
  }
}

/**
 * Get cutout dimensions in meters
 */
function getCutoutDimensions(cutout) {
  if (cutout.type === 'circle') {
    const r = (cutout.radius || 0) / 100;
    return { type: 'circle', radius: r };
  } else {
    return {
      type: 'rectangle',
      width: (cutout.width || 0) / 100,
      height: (cutout.height || 0) / 100
    };
  }
}

// Global texture cache to avoid reloading and track loading state
const textureCache = new Map();
const textureLoadCallbacks = new Map(); // Callbacks to call when texture loads

function loadTextureWithCache(url, onLoad, rendererRef) {
  // If already cached and loaded, call callback immediately
  if (textureCache.has(url)) {
    const cached = textureCache.get(url);
    if (cached.loaded) {
      onLoad(cached.texture);
      return;
    }
    // Still loading - add to callbacks
    if (!textureLoadCallbacks.has(url)) {
      textureLoadCallbacks.set(url, []);
    }
    textureLoadCallbacks.get(url).push(onLoad);
    return;
  }
  
  // Start loading
  textureCache.set(url, { loaded: false, texture: null });
  textureLoadCallbacks.set(url, [onLoad]);
  
  const loader = new THREE.TextureLoader();
  loader.load(url, (texture) => {
    // Configure texture
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    if (rendererRef?.current) {
      texture.anisotropy = rendererRef.current.capabilities?.getMaxAnisotropy() || 4;
    }
    
    // Cache it
    textureCache.set(url, { loaded: true, texture });
    
    // Call all waiting callbacks
    const callbacks = textureLoadCallbacks.get(url) || [];
    callbacks.forEach(cb => cb(texture));
    textureLoadCallbacks.delete(url);
  }, undefined, (error) => {
    console.error('Error loading texture:', url, error);
    textureCache.delete(url);
    textureLoadCallbacks.delete(url);
  });
}

/**
 * Creates a triplanar shader material for proper texture mapping
 * Uses LOCAL coordinates so texture stays fixed when piece is rotated/moved
 * Handles grainLengthwise rotation (90° UV rotation when piece is rotated on tile)
 * Applies texture only on top/front face, solid color on sides
 * 
 * @param {THREE.Texture} texture - The texture to apply
 * @param {Object} layoutInfo - Layout info with tile/piece positions
 * @param {boolean} isBacksplash - If true, project from Z axis, else from Y
 * @param {THREE.Color} fallbackColor - Color to use for sides/back
 * @param {boolean} debugMode - If true, show full texture with transparency
 * @param {number} opacity - Opacity of the material (0-1), default 1.0
 */
function createTriplanarMaterial(texture, layoutInfo, isBacksplash, fallbackColor, debugMode = false, opacity = 1.0, isWaterfall = false, isLeftWaterfall = false) {
  if (!texture || !layoutInfo) {
    return new THREE.MeshBasicMaterial({ color: fallbackColor || 0x666666 });
  }
  
  // Calculate UV offset and scale based on piece position on tile
  const tileW = layoutInfo.tileW;
  const tileH = layoutInfo.tileH;
  const pieceX = layoutInfo.x;
  const pieceY = layoutInfo.y;
  const pieceW = layoutInfo.pieceW;
  const pieceH = layoutInfo.pieceH;
  
  // Check if piece is rotated on tile (grainLengthwise = false means rotated 90°)
  const isRotatedOnTile = layoutInfo.grainLengthwise === false;
  
  // UV offset and scale - these define where on the tile texture this piece maps
  // 
  // Coordinate systems:
  // - Packer: origin top-left, Y increases downward
  // - Shader UV after flip (uv.y = 1 - uv.y): origin bottom-left, but we sample from top
  // 
  // After shader flips uv.y, a piece at packer position (x, y) needs offset:
  // - uvOffsetX = pieceX / tileW (unchanged)
  // - uvOffsetY needs adjustment: when shader does 1-uv.y, we need to offset from the OTHER end
  //   Formula: uvOffsetY = 1 - (pieceY + pieceH) / tileH = (tileH - pieceY - pieceH) / tileH
  const uvOffsetX = pieceX / tileW;
  const uvOffsetY = (tileH - pieceY - pieceH) / tileH;  // Compensate for shader's Y flip
  const uvScaleX = pieceW / tileW;
  const uvScaleY = pieceH / tileH;
  
  // Piece size in meters for local coordinate normalization
  // w, h are ORIGINAL dimensions (before potential rotation for packing)
  // pieceW, pieceH are dimensions ON THE TILE (after rotation if grainLengthwise=false)
  // The mesh always has dimensions w x h (length x depth/height)
  const pieceSizeX = layoutInfo.w / 100;  // Always use original width for mesh X axis
  const pieceSizeY = layoutInfo.h / 100;  // Always use original height/depth for mesh Y/Z axis
  
  const vertexShader = `
    varying vec3 vLocalPosition;
    varying vec3 vLocalNormal;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    
    void main() {
      vLocalPosition = position;
      // Use LOCAL normal directly, not transformed by normalMatrix
      // This ensures face detection works regardless of camera angle
      vLocalNormal = normal;
      // World normal for lighting calculations
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      // World position for lighting
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  
  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform vec2 uPieceOffset;
    uniform vec2 uPieceScale;
    uniform vec2 uPieceSize;
    uniform bool uIsBacksplash;
    uniform bool uIsWaterfall;
    uniform bool uIsLeftWaterfall;
    uniform bool uIsRotatedOnTile;
    uniform vec3 uSideColor;
    uniform bool uDebugMode;
    uniform float uOpacity;
    
    varying vec3 vLocalPosition;
    varying vec3 vLocalNormal;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    
    // Simple lighting calculation with simulated AO
    vec3 calculateLighting(vec3 baseColor, vec3 normal) {
      // Light directions (normalized)
      vec3 mainLightDir = normalize(vec3(0.5, 1.0, 0.5));
      vec3 fillLightDir = normalize(vec3(-0.5, 0.5, -0.5));
      
      // Height-based AO (contact shadow - darker very close to ground)
      float groundHeight = 0.9; // Approximate ground level (90cm countertop height)
      float distFromGround = max(vWorldPosition.y - groundHeight, 0.0);
      float contactAO = smoothstep(0.0, 0.15, distFromGround); // Wider range - 15cm falloff
      contactAO = mix(0.75, 1.0, contactAO);
      
      // General height AO (darker at bottom of scene) - wider range
      float heightAO = smoothstep(0.0, 3.0, vWorldPosition.y);
      heightAO = mix(0.9, 1.0, heightAO);
      
      // Edge/corner AO simulation based on normal direction
      // Underside surfaces (facing down) are darker - simulates shadowed undersides
      float upDot = dot(normal, vec3(0.0, 1.0, 0.0));
      float normalAO = smoothstep(-1.0, 0.3, upDot);
      normalAO = mix(0.8, 1.0, normalAO);
      
      // Cavity AO - darken where surfaces meet at angles
      // Vertical surfaces get slightly darker to show depth
      float verticalFactor = abs(upDot);
      float cavityAO = mix(0.95, 1.0, verticalFactor);
      
      // Combined AO factor
      float aoFactor = contactAO * heightAO * normalAO * cavityAO;
      
      // Ambient with AO - BRIGHTER
      float ambientStrength = 0.6;
      vec3 ambient = ambientStrength * baseColor * aoFactor;
      
      // Main diffuse light with soft shadows - BRIGHTER
      float mainDiff = max(dot(normal, mainLightDir), 0.0);
      mainDiff = mainDiff * 0.5 + 0.5; // Half-Lambert for softer look
      mainDiff = mainDiff * mainDiff; // Square for more natural falloff
      vec3 mainDiffuse = mainDiff * 0.4 * baseColor;
      
      // Fill light (softer, less affected by AO) - BRIGHTER
      float fillDiff = max(dot(normal, fillLightDir), 0.0);
      vec3 fillDiffuse = fillDiff * 0.25 * baseColor;
      
      // Subtle rim light for edge definition
      vec3 viewDir = normalize(-vWorldPosition);
      float rim = 1.0 - max(dot(viewDir, normal), 0.0);
      rim = smoothstep(0.5, 1.0, rim);
      vec3 rimLight = rim * 0.1 * vec3(1.0, 0.98, 0.95); // Slightly warm rim
      
      // Apply AO to diffuse - less aggressive
      return ambient + (mainDiffuse + fillDiffuse) * mix(0.92, 1.0, aoFactor) + rimLight;
    }
    
    void main() {
      vec2 uv;
      
      // Check if this is the top/front face (where texture should appear)
      // Using LOCAL normals so this works regardless of camera orientation
      bool isMainFace = false;
      
      if (uIsBacksplash) {
        // Backsplash: front face has local normal pointing in +Z direction
        isMainFace = vLocalNormal.z > 0.5;
        
        if (isMainFace) {
          // Project from Z axis - X is horizontal, Y is vertical
          // Map local position to 0-1 UV space
          uv.x = (vLocalPosition.x / uPieceSize.x) + 0.5;
          uv.y = (vLocalPosition.y / uPieceSize.y) + 0.5;
          
          // If piece is rotated on tile (grainLengthwise=false):
          if (uIsRotatedOnTile) {
            vec2 swapped = vec2(uv.y, 1.0 - uv.x);
            uv = swapped;
          }
        }
      } else if (uIsWaterfall) {
        // Waterfall: only exterior face gets texture, interior gets side color
        // Left waterfall: exterior is -X (facing away from slab)
        // Right waterfall: exterior is +X (facing away from slab)
        // 
        // Packer layout (horizontal): pieceW = waterfallHeight (90), pieceH = depth (60)
        // 3D geometry: BoxGeometry(thickness, height=90, depth=60)
        
        // Determine which face is exterior based on waterfall side
        if (uIsLeftWaterfall) {
          isMainFace = vLocalNormal.x < -0.5;  // Left waterfall exterior is -X
        } else {
          isMainFace = vLocalNormal.x > 0.5;   // Right waterfall exterior is +X
        }
        
        if (isMainFace) {
          // Map local coordinates to UV
          // Y (height 0-90) → horizontal on tile (pieceW) → UV.x
          // Z (depth 0-60) → vertical on tile (pieceH) → UV.y
          float normY = (vLocalPosition.y / uPieceSize.x) + 0.5;  // 0-1 along height
          float normZ = (vLocalPosition.z / uPieceSize.y) + 0.5;  // 0-1 along depth
          
          uv.x = normY;  // height maps to horizontal texture axis
          uv.y = normZ;  // depth maps to vertical texture axis
          
          // Flip Y to match packer's coordinate system (Y=0 at top)
          uv.y = 1.0 - uv.y;
          
          // For left waterfall (-X face), mirror horizontally so texture reads correctly
          if (uIsLeftWaterfall) {
            uv.x = 1.0 - uv.x;
          }
          
          // Apply rotation transform if piece is rotated on tile
          if (uIsRotatedOnTile) {
            vec2 swapped = vec2(uv.y, 1.0 - uv.x);
            uv = swapped;
          }
        }
      } else {
        // Slab: top face has local normal pointing in +Y direction
        // Use more permissive check because ExtrudeGeometry normals may not be exactly (0,1,0)
        isMainFace = vLocalNormal.y > 0.3 && abs(vLocalNormal.x) < 0.5 && abs(vLocalNormal.z) < 0.5;
        
        if (isMainFace) {
          // Project from Y axis - X is length, Z is depth
          uv.x = (vLocalPosition.x / uPieceSize.x) + 0.5;
          uv.y = (vLocalPosition.z / uPieceSize.y) + 0.5;
          
          // FLIP Y: In 3D, Z+ is "forward", but in packer Y=0 is top (back of counter)
          // So we need to flip to match packer's top-down coordinate system
          uv.y = 1.0 - uv.y;
          
          // If piece is rotated on tile (grainLengthwise=false):
          if (uIsRotatedOnTile) {
            vec2 swapped = vec2(uv.y, 1.0 - uv.x);
            uv = swapped;
          }
        }
      }
      
      if (isMainFace) {
        // Map UV from piece space to tile texture space
        // tileUV goes from uPieceOffset to uPieceOffset + uPieceScale as uv goes 0 to 1
        vec2 tileUV = uPieceOffset + uv * uPieceScale;
        
        if (uDebugMode) {
          // DEBUG MODE: Show piece texture with gold border
          // The actual tile visualization is done with a separate helper mesh
          
          vec4 texColor = texture2D(uTexture, tileUV);
          
          // Border at piece edges
          float borderW = 0.02;
          bool atPieceBorder = uv.x < borderW || uv.x > 1.0 - borderW || 
                               uv.y < borderW || uv.y > 1.0 - borderW;
          
          if (atPieceBorder) {
            // GOLD border = piece edges
            gl_FragColor = vec4(0.79, 0.66, 0.38, 1.0);
          } else {
            // Show texture with slight transparency so tile helper shows through
            vec3 litColor = calculateLighting(texColor.rgb, vWorldNormal);
            gl_FragColor = vec4(litColor, 0.9);
          }
        } else {
          vec4 texColor = texture2D(uTexture, tileUV);
          vec3 litColor = calculateLighting(texColor.rgb, vWorldNormal);
          gl_FragColor = vec4(litColor, uOpacity);
        }
      } else {
        // Sides and back: solid color with lighting
        vec3 litColor = calculateLighting(uSideColor, vWorldNormal);
        gl_FragColor = vec4(litColor, uOpacity);
      }
    }
  `;
  
  // Calculate average color from fallback (or use a neutral gray)
  const sideColor = fallbackColor ? 
    new THREE.Color(fallbackColor).multiplyScalar(0.8) : 
    new THREE.Color(0.4, 0.4, 0.4);
  
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: texture },
      uPieceOffset: { value: new THREE.Vector2(uvOffsetX, uvOffsetY) },
      uPieceScale: { value: new THREE.Vector2(uvScaleX, uvScaleY) },
      uPieceSize: { value: new THREE.Vector2(pieceSizeX, pieceSizeY) },
      uIsBacksplash: { value: isBacksplash },
      uIsWaterfall: { value: isWaterfall },
      uIsLeftWaterfall: { value: isLeftWaterfall },
      uIsRotatedOnTile: { value: isRotatedOnTile },
      uSideColor: { value: sideColor },
      uDebugMode: { value: debugMode },
      uOpacity: { value: opacity }
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: opacity < 1.0 || debugMode,
    depthWrite: opacity >= 1.0 && !debugMode
  });
  
  return material;
}

/**
 * Creates a debug tile helper mesh that shows the full tile texture
 * Used to visualize where a piece is positioned on its source tile
 * 
 * @param {THREE.Mesh} parentMesh - The piece mesh to attach helper to
 * @param {Object} layoutInfo - Layout info with piece position on tile
 * @param {Object} colorData - Color data with texture URL
 * @param {boolean} isBacksplash - If true, piece is vertical backsplash
 * @param {THREE.Color} color - Fallback color
 * @param {Object} refs - Object containing rendererRef, sceneRef, cameraRef for re-render
 * @returns {THREE.Mesh} The tile helper mesh (already added to parentMesh)
 */
function createTileHelper(parentMesh, layoutInfo, colorData, isBacksplash, color, refs) {
  if (!layoutInfo || !colorData.texture) return null;
  
  const tileW = layoutInfo.tileW / 100; // tile width in meters
  const tileH = layoutInfo.tileH / 100; // tile height in meters
  
  // Piece position on tile in packer coordinates (in meters)
  const pieceX = layoutInfo.x / 100;
  const pieceY = layoutInfo.y / 100;
  const pieceW = layoutInfo.pieceW / 100;
  const pieceH = layoutInfo.pieceH / 100;
  
  const isRotatedOnTile = layoutInfo.grainLengthwise === false;
  
  // Calculate offset from piece center to tile center
  const tileCenterX = tileW / 2;
  const tileCenterY = tileH / 2;
  const pieceCenterOnTileX = pieceX + pieceW / 2;
  const pieceCenterOnTileY = pieceY + pieceH / 2;
  
  const offsetTileX = tileCenterX - pieceCenterOnTileX;
  const offsetTileY = tileCenterY - pieceCenterOnTileY;
  
  // Create tile geometry - use BoxGeometry for consistent normals with shader
  let tileGeo;
  if (isBacksplash) {
    tileGeo = new THREE.BoxGeometry(tileW, tileH, 0.01);
  } else {
    if (isRotatedOnTile) {
      tileGeo = new THREE.BoxGeometry(tileH, 0.01, tileW);
    } else {
      tileGeo = new THREE.BoxGeometry(tileW, 0.01, tileH);
    }
  }
  
  // Create layout info for the FULL TILE (offset 0, scale 1)
  const fullTileLayoutInfo = {
    x: 0,
    y: 0,
    w: isRotatedOnTile ? layoutInfo.tileH : layoutInfo.tileW,
    h: isRotatedOnTile ? layoutInfo.tileW : layoutInfo.tileH,
    pieceW: layoutInfo.tileW,
    pieceH: layoutInfo.tileH,
    tileW: layoutInfo.tileW,
    tileH: layoutInfo.tileH,
    grainLengthwise: !isRotatedOnTile
  };
  
  // Create placeholder material
  const tileMat = new THREE.MeshBasicMaterial({ 
    color: color,
    transparent: true,
    opacity: 0.5
  });
  
  const tileMesh = new THREE.Mesh(tileGeo, tileMat);
  tileMesh.renderOrder = -1;
  
  // IMPORTANT: Disable raycast so tile helper doesn't block piece selection
  tileMesh.raycast = () => {};
  
  // Position in LOCAL space of parent mesh
  if (isBacksplash) {
    tileMesh.position.set(offsetTileX, -offsetTileY, -0.005);
  } else {
    tileMesh.position.set(offsetTileX, -0.005, offsetTileY);
  }
  
  // No local rotation - inherits parent rotation
  tileMesh.rotation.set(0, 0, 0);
  
  // Mark as debug helper for cleanup
  tileMesh.userData.isDebugTileHelper = true;
  
  // Add cyan wireframe border
  const tileEdges = new THREE.EdgesGeometry(tileGeo);
  const tileLineMat = new THREE.LineBasicMaterial({ 
    color: 0x00ffff,
    linewidth: 2,
    depthTest: false,
  });
  const tileOutline = new THREE.LineSegments(tileEdges, tileLineMat);
  tileOutline.renderOrder = 999;
  tileMesh.add(tileOutline);
  
  // Add as child of parent mesh
  parentMesh.add(tileMesh);
  
  // Load texture using cache and apply triplanar shader
  loadTextureWithCache(colorData.texture, (texture) => {
    const tileTriplanarMat = createTriplanarMaterial(texture, fullTileLayoutInfo, isBacksplash, color, false, 0.5);
    
    tileMesh.material.dispose();
    tileMesh.material = tileTriplanarMat;
    
    // Force re-render
    if (refs.rendererRef?.current && refs.sceneRef?.current && refs.cameraRef?.current) {
      refs.rendererRef.current.render(refs.sceneRef.current, refs.cameraRef.current);
    }
  }, refs.rendererRef);
  
  return tileMesh;
}

// ============================================
// LAYOUT & TEXTURE MAPPING - SINGLE SOURCE OF TRUTH
// ============================================

/**
 * Computes the layout of all pieces on tiles.
 * This is the SINGLE SOURCE OF TRUTH for both 2D preview and 3D UV mapping.
 * 
 * PACKING PRIORITIES:
 * 1. Slab + waterfall(s) together with common edges touching
 * 2. Try all 3 (slab + left + right) on same tile
 * 3. If not, at least slab + 1 waterfall together
 * 4. Maximize efficiency (minimize waste)
 * 
 * LAYOUT ARRANGEMENTS:
 * - Layout A (L-shape): Slab on top, waterfalls below at edges
 * - Layout B (Linear): [LWF][SLAB][RWF] in a row  
 * - Layout C (Separate): Each piece individually
 */
function computeLayout(elements, library, fixedPieces = {}) {
  // fixedPieces = { "elementId_key": { tileIndex, x, y, isManual } }
  const pieces = [];
  const tiles = [];
  const piecesByKey = {};
  
  if (!elements || elements.length === 0 || !library || !library.colors) {
    return { pieces, tiles, piecesByKey };
  }
  
  // Filter out cabinets - they don't need layout calculation
  const layoutElements = elements.filter(el => el.type !== 'cabinet');
  
  // Step 1: Separate slab+waterfall sets from standalone pieces
  const slabSets = [];
  const standalonePieces = [];
  
  layoutElements.forEach(el => {
    const thickness = el.thickness || 12;
    const colorId = el.material;
    const waterfallH = el.waterfallHeight || el.placementHeight || 90;
    const grainLengthwise = el.grainLengthwise !== false;
    
    if (el.type === 'backsplash') {
      standalonePieces.push({ 
        elementId: el.id, 
        key: 'main', 
        name: el.name, 
        w: el.length, 
        h: el.height, 
        colorId, 
        thickness, 
        grainLengthwise,
        pieceType: 'backsplash'
      });
    } else {
      const hasLeft = el.type === 'island' && el.waterfallLeft;
      const hasRight = el.type === 'island' && el.waterfallRight;
      const slabGroup = `${el.id}_slab`;
      
      const slab = { 
        elementId: el.id, 
        key: 'main', 
        name: `${el.name} - Blat`, 
        w: el.length, 
        h: el.depth, 
        colorId, 
        thickness, 
        grainLengthwise,
        pieceType: 'slab',
        slabGroup
      };
      
      const leftWf = hasLeft ? { 
        elementId: el.id, 
        key: 'left', 
        name: `${el.name} - Stânga`, 
        w: el.depth,
        h: waterfallH,
        colorId, 
        thickness, 
        grainLengthwise: false,
        pieceType: 'waterfall',
        waterfallSide: 'left',
        slabGroup
      } : null;
      
      const rightWf = hasRight ? { 
        elementId: el.id, 
        key: 'right', 
        name: `${el.name} - Dreapta`, 
        w: el.depth, 
        h: waterfallH, 
        colorId, 
        thickness, 
        grainLengthwise: false,
        pieceType: 'waterfall',
        waterfallSide: 'right',
        slabGroup
      } : null;
      
      if (hasLeft || hasRight) {
        slabSets.push({ slab, leftWf, rightWf, colorId, thickness });
      } else {
        standalonePieces.push(slab);
      }
    }
  });
  
  // Step 2: Group by material
  const groupKey = (colorId, thickness) => `${colorId}_${thickness}mm`;
  
  const slabSetsByGroup = {};
  slabSets.forEach(set => {
    const key = groupKey(set.colorId, set.thickness);
    if (!slabSetsByGroup[key]) slabSetsByGroup[key] = [];
    slabSetsByGroup[key].push(set);
  });
  
  const standaloneByGroup = {};
  standalonePieces.forEach(p => {
    const key = groupKey(p.colorId, p.thickness);
    if (!standaloneByGroup[key]) standaloneByGroup[key] = [];
    standaloneByGroup[key].push(p);
  });
  
  const allGroups = new Set([...Object.keys(slabSetsByGroup), ...Object.keys(standaloneByGroup)]);
  
  // Step 3: Process each material group
  allGroups.forEach(gKey => {
    const [colorId, thicknessStr] = gKey.split('_');
    const thickness = parseFloat(thicknessStr);
    
    const format = library.formats.find(f => f.colorId === colorId && f.thickness === thickness) 
      || { length: 320, width: 160 };
    const TW = format.length;
    const TH = format.width;
    
    const groupTiles = [];
    
    // Helper: create piece object
    const createPiece = (p, x, y, pieceW, pieceH, tileIdx, rotated = false) => ({
      elementId: p.elementId,
      key: p.key,
      name: p.name,
      pieceType: p.pieceType,
      colorId: p.colorId,
      thickness: p.thickness,
      grainLengthwise: p.grainLengthwise,
      slabGroup: p.slabGroup,
      waterfallSide: p.waterfallSide,
      w: p.w,
      h: p.h,
      pieceW,
      pieceH,
      x,
      y,
      tileIndex: tiles.length + tileIdx,
      tileW: TW,
      tileH: TH,
      rotated,
      exceeds: false
    });
    
    // Helper: create new tile with optional initial occupied spaces
    const createTile = (occupiedRects = []) => {
      const idx = groupTiles.length;
      // Start with full tile space
      let spaces = [{ x: 0, y: 0, w: TW, h: TH }];
      
      // Subtract occupied rectangles (from fixed pieces)
      occupiedRects.forEach(rect => {
        const newSpaces = [];
        spaces.forEach(sp => {
          // Check if this space overlaps with the occupied rect
          const overlapsX = sp.x < rect.x + rect.w && sp.x + sp.w > rect.x;
          const overlapsY = sp.y < rect.y + rect.h && sp.y + sp.h > rect.y;
          
          if (overlapsX && overlapsY) {
            // Subtract the occupied rect from this space
            // Left remainder
            if (sp.x < rect.x) {
              newSpaces.push({ x: sp.x, y: sp.y, w: rect.x - sp.x, h: sp.h });
            }
            // Right remainder
            if (sp.x + sp.w > rect.x + rect.w) {
              newSpaces.push({ x: rect.x + rect.w, y: sp.y, w: (sp.x + sp.w) - (rect.x + rect.w), h: sp.h });
            }
            // Top remainder
            if (sp.y < rect.y) {
              newSpaces.push({ x: Math.max(sp.x, rect.x), y: sp.y, w: Math.min(sp.x + sp.w, rect.x + rect.w) - Math.max(sp.x, rect.x), h: rect.y - sp.y });
            }
            // Bottom remainder
            if (sp.y + sp.h > rect.y + rect.h) {
              newSpaces.push({ x: Math.max(sp.x, rect.x), y: rect.y + rect.h, w: Math.min(sp.x + sp.w, rect.x + rect.w) - Math.max(sp.x, rect.x), h: (sp.y + sp.h) - (rect.y + rect.h) });
            }
          } else {
            // No overlap, keep the space
            newSpaces.push(sp);
          }
        });
        spaces = newSpaces;
      });
      
      // Filter out invalid spaces (negative or zero dimensions)
      spaces = spaces.filter(sp => sp.w > 0 && sp.h > 0);
      
      groupTiles.push({ 
        spaces: spaces.length > 0 ? spaces : [],
        colorId,
        thickness,
        format
      });
      return idx;
    };
    
    // Get fixed pieces for this material group
    const groupFixedPieces = Object.entries(fixedPieces).filter(([key, fp]) => {
      // Find the piece info to check colorId and thickness
      const [elementId] = key.split('_');
      const el = elements.find(e => e.id === elementId);
      if (!el) return false;
      return el.material === colorId && (el.thickness || 12) === thickness && fp.isManual;
    });
    
    // Pre-create tiles for fixed pieces and add them to pieces array
    const fixedByTile = {};
    groupFixedPieces.forEach(([key, fp]) => {
      if (!fixedByTile[fp.tileIndex]) fixedByTile[fp.tileIndex] = [];
      fixedByTile[fp.tileIndex].push({ key, ...fp });
    });
    
    // Create tiles with fixed pieces as obstacles
    const maxFixedTileIdx = Math.max(-1, ...Object.keys(fixedByTile).map(Number));
    for (let i = 0; i <= maxFixedTileIdx; i++) {
      const fixedOnTile = fixedByTile[i] || [];
      const occupiedRects = fixedOnTile.map(fp => {
        // Use saved dimensions if available
        if (fp.pieceW !== undefined && fp.pieceH !== undefined) {
          return { x: fp.x, y: fp.y, w: fp.pieceW, h: fp.pieceH };
        }
        
        // Fallback: calculate from element
        const [elementId, pieceKey] = fp.key.split('_');
        const el = elements.find(e => e.id === elementId);
        if (!el) return null;
        
        let pieceW, pieceH;
        if (pieceKey === 'main') {
          if (el.type === 'backsplash') {
            pieceW = el.length;
            pieceH = el.height;
          } else {
            pieceW = el.grainLengthwise !== false ? el.length : el.depth;
            pieceH = el.grainLengthwise !== false ? el.depth : el.length;
          }
        } else {
          // Waterfall piece
          const waterfallH = el.waterfallHeight || el.placementHeight || 90;
          pieceW = waterfallH; // rotated on tile
          pieceH = el.depth;
        }
        
        return { x: fp.x, y: fp.y, w: pieceW, h: pieceH };
      }).filter(Boolean);
      
      createTile(occupiedRects);
      
      // Add fixed pieces to the pieces array
      fixedOnTile.forEach(fp => {
        const [elementId, pieceKey] = fp.key.split('_');
        const el = elements.find(e => e.id === elementId);
        if (!el) return;
        
        let pieceW, pieceH, pieceType, waterfallSide = null, slabGroup = null;
        let rotated = false;
        const grainLengthwise = el.grainLengthwise !== false;
        
        // Use saved dimensions if available (preserves rotation/grain state)
        if (fp.pieceW !== undefined && fp.pieceH !== undefined) {
          pieceW = fp.pieceW;
          pieceH = fp.pieceH;
          rotated = fp.rotated || false;
        } else {
          // Fallback: calculate from element
          if (pieceKey === 'main') {
            if (el.type === 'backsplash') {
              pieceW = el.length;
              pieceH = el.height;
            } else {
              pieceW = grainLengthwise ? el.length : el.depth;
              pieceH = grainLengthwise ? el.depth : el.length;
            }
          } else {
            const waterfallH = el.waterfallHeight || el.placementHeight || 90;
            pieceW = waterfallH;
            pieceH = el.depth;
            rotated = true;
          }
        }
        
        if (pieceKey === 'main') {
          pieceType = el.type === 'backsplash' ? 'backsplash' : 'slab';
          if (el.type !== 'backsplash') slabGroup = `${el.id}_slab`;
        } else {
          pieceType = 'waterfall';
          waterfallSide = pieceKey;
          slabGroup = `${el.id}_slab`;
        }
        
        const piece = {
          elementId,
          key: pieceKey,
          name: el.name + (pieceKey === 'main' ? '' : pieceKey === 'left' ? ' - Stânga' : ' - Dreapta'),
          pieceType,
          colorId,
          thickness,
          grainLengthwise: pieceKey === 'main' ? grainLengthwise : false,
          slabGroup,
          waterfallSide,
          // w and h are the "natural" dimensions, pieceW/pieceH are on-tile dimensions
          w: pieceKey === 'main' ? (el.type === 'backsplash' ? el.length : el.length) : el.depth,
          h: pieceKey === 'main' ? (el.type === 'backsplash' ? el.height : el.depth) : (el.waterfallHeight || el.placementHeight || 90),
          pieceW,
          pieceH,
          x: fp.x,
          y: fp.y,
          tileIndex: tiles.length + i,
          tileW: TW,
          tileH: TH,
          rotated,
          exceeds: pieceW > TW || pieceH > TH,
          isManual: true
        };
        pieces.push(piece);
        piecesByKey[fp.key] = piece;
      });
    }
    
    // Helper: merge adjacent spaces into larger continuous rectangles
    // This allows pieces to fit in spaces that span multiple guillotine cuts
    const mergeSpaces = (tileIdx) => {
      const spaces = groupTiles[tileIdx].spaces;
      
      // First remove any existing virtual spaces
      for (let i = spaces.length - 1; i >= 0; i--) {
        if (spaces[i].virtual) spaces.splice(i, 1);
      }
      
      // Merge adjacent real spaces
      let merged = true;
      while (merged) {
        merged = false;
        
        for (let i = 0; i < spaces.length && !merged; i++) {
          for (let j = i + 1; j < spaces.length && !merged; j++) {
            const a = spaces[i];
            const b = spaces[j];
            
            // Skip virtual spaces in merging
            if (a.virtual || b.virtual) continue;
            
            // Check horizontal merge (same Y, same height, adjacent X)
            if (a.y === b.y && a.h === b.h && a.x + a.w === b.x) {
              a.w += b.w;
              spaces.splice(j, 1);
              merged = true;
            }
            // Check horizontal merge (reverse direction)
            else if (a.y === b.y && a.h === b.h && b.x + b.w === a.x) {
              a.x = b.x;
              a.w += b.w;
              spaces.splice(j, 1);
              merged = true;
            }
            // Check vertical merge (same X, same width, adjacent Y)
            else if (a.x === b.x && a.w === b.w && a.y + a.h === b.y) {
              a.h += b.h;
              spaces.splice(j, 1);
              merged = true;
            }
            // Check vertical merge (reverse direction)
            else if (a.x === b.x && a.w === b.w && b.y + b.h === a.y) {
              a.y = b.y;
              a.h += b.h;
              spaces.splice(j, 1);
              merged = true;
            }
          }
        }
      }
      
      // Generate "virtual" larger spaces from adjacent regions
      // This finds rectangles that span multiple spaces
      const virtualSpaces = [];
      const realSpaces = spaces.filter(s => !s.virtual);
      
      for (const space of realSpaces) {
        // Find spaces that are adjacent to the right
        for (const other of realSpaces) {
          if (other === space) continue;
          
          // Other space is to the right and overlaps vertically
          if (other.x === space.x + space.w && 
              other.y < space.y + space.h && 
              other.y + other.h > space.y) {
            const overlapTop = Math.max(space.y, other.y);
            const overlapBottom = Math.min(space.y + space.h, other.y + other.h);
            const overlapH = overlapBottom - overlapTop;
            
            if (overlapH > 0) {
              virtualSpaces.push({
                x: space.x,
                y: overlapTop,
                w: space.w + other.w,
                h: overlapH,
                virtual: true
              });
            }
          }
          
          // Other space is below and overlaps horizontally
          if (other.y === space.y + space.h && 
              other.x < space.x + space.w && 
              other.x + other.w > space.x) {
            const overlapLeft = Math.max(space.x, other.x);
            const overlapRight = Math.min(space.x + space.w, other.x + other.w);
            const overlapW = overlapRight - overlapLeft;
            
            if (overlapW > 0) {
              virtualSpaces.push({
                x: overlapLeft,
                y: space.y,
                w: overlapW,
                h: space.h + other.h,
                virtual: true
              });
            }
          }
        }
      }
      
      // Add virtual spaces
      spaces.push(...virtualSpaces);
      
      // Remove duplicates
      for (let i = spaces.length - 1; i >= 0; i--) {
        for (let j = i - 1; j >= 0; j--) {
          if (spaces[i] && spaces[j] &&
              spaces[i].x === spaces[j].x && 
              spaces[i].y === spaces[j].y && 
              spaces[i].w === spaces[j].w && 
              spaces[i].h === spaces[j].h) {
            spaces.splice(i, 1);
            break;
          }
        }
      }
    };
    
    // Helper: find space in tiles (prefers real spaces over virtual)
    const findSpace = (needW, needH) => {
      // First pass: look for real (non-virtual) spaces
      for (let t = 0; t < groupTiles.length; t++) {
        for (let s = 0; s < groupTiles[t].spaces.length; s++) {
          const sp = groupTiles[t].spaces[s];
          if (!sp.virtual && needW <= sp.w && needH <= sp.h) {
            return { tileIdx: t, spaceIdx: s, x: sp.x, y: sp.y, space: sp };
          }
        }
      }
      // Second pass: look for virtual spaces (merged areas)
      for (let t = 0; t < groupTiles.length; t++) {
        for (let s = 0; s < groupTiles[t].spaces.length; s++) {
          const sp = groupTiles[t].spaces[s];
          if (sp.virtual && needW <= sp.w && needH <= sp.h) {
            return { tileIdx: t, spaceIdx: s, x: sp.x, y: sp.y, space: sp };
          }
        }
      }
      return null;
    };
    
    // Helper: update spaces after placement
    // Uses "guillotine" split: right remainder gets FULL height, bottom gets remaining width
    const useSpace = (tileIdx, spaceIdx, x, y, w, h) => {
      const spaces = groupTiles[tileIdx].spaces;
      const sp = spaces[spaceIdx];
      
      // If this is a virtual space, we need to handle it differently
      // Remove all spaces that overlap with the placed piece
      if (sp.virtual) {
        // Remove the virtual space first
        spaces.splice(spaceIdx, 1);
        
        // Find and update all real spaces that overlap with the placed rectangle
        const placedRect = { x, y, w, h };
        
        for (let i = spaces.length - 1; i >= 0; i--) {
          const s = spaces[i];
          
          // Check if this space overlaps with placed piece
          const overlapsX = s.x < x + w && s.x + s.w > x;
          const overlapsY = s.y < y + h && s.y + s.h > y;
          
          if (overlapsX && overlapsY) {
            // This space overlaps - need to subtract the placed piece from it
            spaces.splice(i, 1);
            
            // Create remaining spaces after subtracting the placed rectangle
            // Left remainder
            if (s.x < x) {
              spaces.push({ x: s.x, y: s.y, w: x - s.x, h: s.h });
            }
            // Right remainder
            if (s.x + s.w > x + w) {
              spaces.push({ x: x + w, y: s.y, w: (s.x + s.w) - (x + w), h: s.h });
            }
            // Top remainder
            if (s.y < y) {
              spaces.push({ x: s.x, y: s.y, w: s.w, h: y - s.y });
            }
            // Bottom remainder
            if (s.y + s.h > y + h) {
              spaces.push({ x: s.x, y: y + h, w: s.w, h: (s.y + s.h) - (y + h) });
            }
          }
        }
        
        // Also remove any remaining virtual spaces (they'll be regenerated)
        for (let i = spaces.length - 1; i >= 0; i--) {
          if (spaces[i].virtual) spaces.splice(i, 1);
        }
        
        // Regenerate virtual spaces
        mergeSpaces(tileIdx);
        
        // Sort
        spaces.sort((a, b) => {
          if (a.y !== b.y) return a.y - b.y;
          if (a.x !== b.x) return a.x - b.x;
          return (b.w * b.h) - (a.w * a.h);
        });
        
        return;
      }
      
      // Regular space handling (non-virtual)
      const newSpaces = [];
      
      // Right remainder - FULL HEIGHT of original space (guillotine cut)
      if (sp.w - w > 0) {
        newSpaces.push({ x: x + w, y: sp.y, w: sp.w - w, h: sp.h });
      }
      // Bottom remainder - only the width we used
      if (sp.h - h > 0) {
        newSpaces.push({ x: sp.x, y: y + h, w: w, h: sp.h - h });
      }
      
      spaces.splice(spaceIdx, 1, ...newSpaces);
      
      // Merge adjacent spaces to create larger continuous areas
      mergeSpaces(tileIdx);
      
      // Sort: prefer top-left, then by area (larger spaces first for better packing)
      spaces.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        if (a.x !== b.x) return a.x - b.x;
        return (b.w * b.h) - (a.w * a.h);
      });
    };
    
    // Process slab sets with priority
    const sets = slabSetsByGroup[gKey] || [];
    
    sets.forEach(set => {
      const { slab, leftWf, rightWf } = set;
      
      // Skip if any part of this set is already fixed
      const slabKey = `${slab.elementId}_${slab.key}`;
      const leftKey = leftWf ? `${leftWf.elementId}_${leftWf.key}` : null;
      const rightKey = rightWf ? `${rightWf.elementId}_${rightWf.key}` : null;
      
      if (fixedPieces[slabKey]?.isManual || 
          (leftKey && fixedPieces[leftKey]?.isManual) || 
          (rightKey && fixedPieces[rightKey]?.isManual)) {
        return; // Skip - already placed as fixed
      }
      
      // Slab dimensions (grainLengthwise: w on X, h on Y)
      const slabW = slab.grainLengthwise ? slab.w : slab.h;
      const slabH = slab.grainLengthwise ? slab.h : slab.w;
      
      // Waterfall dimensions for JOINED layout:
      // The common edge is the slab's depth (60cm) = waterfall's depth (60cm)
      // For continuous grain, waterfall must be oriented so:
      // - The 60cm edge (depth) is vertical, touching slab's 60cm edge
      // - The 90cm edge (height) extends horizontally outward
      // So on tile: wfW = waterfallHeight (90), wfH = depth (60)
      const wfH_common = leftWf ? leftWf.w : (rightWf ? rightWf.w : 0);  // 60 - common edge (depth)
      const wfW_extend = leftWf ? leftWf.h : (rightWf ? rightWf.h : 0);  // 90 - extending edge (height)
      
      const hasLeft = !!leftWf;
      const hasRight = !!rightWf;
      const hasBoth = hasLeft && hasRight;
      
      let placed = false;
      
      // ===== LAYOUT A: Horizontal with common edges =====
      // Waterfalls extend horizontally from slab edges, common 60cm edge vertical
      //
      // [LWF 90×60][----SLAB 120×60----][RWF 90×60]
      //     ↑              ↑                 ↑
      //   90×60         120×60            90×60
      //
      // Common edges (60cm) are touching vertically
      // Grain continues horizontally across all pieces
      if (!placed) {
        const totalW = (hasLeft ? wfW_extend : 0) + slabW + (hasRight ? wfW_extend : 0);
        const totalH = Math.max(slabH, wfH_common);  // Should be same (60cm)
        
        if (totalW <= TW && totalH <= TH) {
          const found = findSpace(totalW, totalH);
          let tileIdx, baseX, baseY;
          
          if (found) {
            tileIdx = found.tileIdx;
            baseX = found.x;
            baseY = found.y;
            useSpace(tileIdx, found.spaceIdx, baseX, baseY, totalW, totalH);
          } else {
            tileIdx = createTile();
            baseX = 0;
            baseY = 0;
            groupTiles[tileIdx].spaces = [];
            if (TW - totalW > 0) groupTiles[tileIdx].spaces.push({ x: totalW, y: 0, w: TW - totalW, h: TH });
            if (TH - totalH > 0) groupTiles[tileIdx].spaces.push({ x: 0, y: totalH, w: totalW, h: TH - totalH });
          }
          
          let currentX = baseX;
          
          // Left waterfall (extends left from slab)
          if (hasLeft) {
            // Waterfall: 90×60 on tile (wfW_extend × wfH_common)
            const lwfPiece = createPiece(leftWf, currentX, baseY, wfW_extend, wfH_common, tileIdx, true);
            pieces.push(lwfPiece);
            piecesByKey[`${leftWf.elementId}_${leftWf.key}`] = lwfPiece;
            currentX += wfW_extend;
          }
          
          // Slab
          const slabPiece = createPiece(slab, currentX, baseY, slabW, slabH, tileIdx);
          pieces.push(slabPiece);
          piecesByKey[`${slab.elementId}_${slab.key}`] = slabPiece;
          currentX += slabW;
          
          // Right waterfall (extends right from slab)
          if (hasRight) {
            const rwfPiece = createPiece(rightWf, currentX, baseY, wfW_extend, wfH_common, tileIdx, true);
            pieces.push(rwfPiece);
            piecesByKey[`${rightWf.elementId}_${rightWf.key}`] = rwfPiece;
          }
          
          placed = true;
        }
      }
      
      // ===== LAYOUT B: Slab + ONE waterfall (priority: keep slab with at least one waterfall) =====
      // If all 3 don't fit in line, try slab + left waterfall first, then slab + right
      //
      // [LWF 90×60][----SLAB 120×60----]  or  [----SLAB 120×60----][RWF 90×60]
      //
      if (!placed && hasLeft) {
        const totalW = wfW_extend + slabW;
        const totalH = Math.max(slabH, wfH_common);
        
        if (totalW <= TW && totalH <= TH) {
          const found = findSpace(totalW, totalH);
          let tileIdx, baseX, baseY;
          
          if (found) {
            tileIdx = found.tileIdx;
            baseX = found.x;
            baseY = found.y;
            useSpace(tileIdx, found.spaceIdx, baseX, baseY, totalW, totalH);
          } else {
            tileIdx = createTile();
            baseX = 0;
            baseY = 0;
            groupTiles[tileIdx].spaces = [];
            if (TW - totalW > 0) groupTiles[tileIdx].spaces.push({ x: totalW, y: 0, w: TW - totalW, h: TH });
            if (TH - totalH > 0) groupTiles[tileIdx].spaces.push({ x: 0, y: totalH, w: totalW, h: TH - totalH });
          }
          
          // Left waterfall first
          const lwfPiece = createPiece(leftWf, baseX, baseY, wfW_extend, wfH_common, tileIdx, true);
          pieces.push(lwfPiece);
          piecesByKey[`${leftWf.elementId}_${leftWf.key}`] = lwfPiece;
          
          // Then slab
          const slabPiece = createPiece(slab, baseX + wfW_extend, baseY, slabW, slabH, tileIdx);
          pieces.push(slabPiece);
          piecesByKey[`${slab.elementId}_${slab.key}`] = slabPiece;
          
          // Right waterfall goes separately if exists
          if (hasRight) {
            const rwfFound = findSpace(wfW_extend, wfH_common);
            if (rwfFound) {
              const rwfPiece = createPiece(rightWf, rwfFound.x, rwfFound.y, wfW_extend, wfH_common, rwfFound.tileIdx, true);
              pieces.push(rwfPiece);
              piecesByKey[`${rightWf.elementId}_${rightWf.key}`] = rwfPiece;
              useSpace(rwfFound.tileIdx, rwfFound.spaceIdx, rwfFound.x, rwfFound.y, wfW_extend, wfH_common);
            } else {
              const newIdx = createTile();
              const rwfPiece = createPiece(rightWf, 0, 0, wfW_extend, wfH_common, newIdx, true);
              pieces.push(rwfPiece);
              piecesByKey[`${rightWf.elementId}_${rightWf.key}`] = rwfPiece;
              groupTiles[newIdx].spaces = [];
              // Guillotine split
              if (TW - wfW_extend > 0) groupTiles[newIdx].spaces.push({ x: wfW_extend, y: 0, w: TW - wfW_extend, h: TH });
              if (TH - wfH_common > 0) groupTiles[newIdx].spaces.push({ x: 0, y: wfH_common, w: wfW_extend, h: TH - wfH_common });
            }
          }
          
          placed = true;
        }
      }
      
      // ===== LAYOUT C: Slab + right waterfall (if left doesn't exist or B didn't work) =====
      if (!placed && hasRight) {
        const totalW = slabW + wfW_extend;
        const totalH = Math.max(slabH, wfH_common);
        
        if (totalW <= TW && totalH <= TH) {
          const found = findSpace(totalW, totalH);
          let tileIdx, baseX, baseY;
          
          if (found) {
            tileIdx = found.tileIdx;
            baseX = found.x;
            baseY = found.y;
            useSpace(tileIdx, found.spaceIdx, baseX, baseY, totalW, totalH);
          } else {
            tileIdx = createTile();
            baseX = 0;
            baseY = 0;
            groupTiles[tileIdx].spaces = [];
            if (TW - totalW > 0) groupTiles[tileIdx].spaces.push({ x: totalW, y: 0, w: TW - totalW, h: TH });
            if (TH - totalH > 0) groupTiles[tileIdx].spaces.push({ x: 0, y: totalH, w: totalW, h: TH - totalH });
          }
          
          // Slab first
          const slabPiece = createPiece(slab, baseX, baseY, slabW, slabH, tileIdx);
          pieces.push(slabPiece);
          piecesByKey[`${slab.elementId}_${slab.key}`] = slabPiece;
          
          // Right waterfall
          const rwfPiece = createPiece(rightWf, baseX + slabW, baseY, wfW_extend, wfH_common, tileIdx, true);
          pieces.push(rwfPiece);
          piecesByKey[`${rightWf.elementId}_${rightWf.key}`] = rwfPiece;
          
          // Left waterfall goes separately if exists (and wasn't placed)
          if (hasLeft && !piecesByKey[`${leftWf.elementId}_${leftWf.key}`]) {
            const lwfFound = findSpace(wfW_extend, wfH_common);
            if (lwfFound) {
              const lwfPiece = createPiece(leftWf, lwfFound.x, lwfFound.y, wfW_extend, wfH_common, lwfFound.tileIdx, true);
              pieces.push(lwfPiece);
              piecesByKey[`${leftWf.elementId}_${leftWf.key}`] = lwfPiece;
              useSpace(lwfFound.tileIdx, lwfFound.spaceIdx, lwfFound.x, lwfFound.y, wfW_extend, wfH_common);
            } else {
              const newIdx = createTile();
              const lwfPiece = createPiece(leftWf, 0, 0, wfW_extend, wfH_common, newIdx, true);
              pieces.push(lwfPiece);
              piecesByKey[`${leftWf.elementId}_${leftWf.key}`] = lwfPiece;
              groupTiles[newIdx].spaces = [];
              // Guillotine split
              if (TW - wfW_extend > 0) groupTiles[newIdx].spaces.push({ x: wfW_extend, y: 0, w: TW - wfW_extend, h: TH });
              if (TH - wfH_common > 0) groupTiles[newIdx].spaces.push({ x: 0, y: wfH_common, w: wfW_extend, h: TH - wfH_common });
            }
          }
          
          placed = true;
        }
      }
      
      // ===== FALLBACK: Place pieces separately =====
      if (!placed) {
        // Place slab
        const slabFound = findSpace(slabW, slabH);
        let slabTileIdx;
        
        if (slabFound) {
          slabTileIdx = slabFound.tileIdx;
          const slabPiece = createPiece(slab, slabFound.x, slabFound.y, slabW, slabH, slabTileIdx);
          pieces.push(slabPiece);
          piecesByKey[`${slab.elementId}_${slab.key}`] = slabPiece;
          useSpace(slabTileIdx, slabFound.spaceIdx, slabFound.x, slabFound.y, slabW, slabH);
        } else {
          slabTileIdx = createTile();
          const slabPiece = createPiece(slab, 0, 0, slabW, slabH, slabTileIdx);
          slabPiece.exceeds = slabW > TW || slabH > TH;
          pieces.push(slabPiece);
          piecesByKey[`${slab.elementId}_${slab.key}`] = slabPiece;
          groupTiles[slabTileIdx].spaces = [];
          // Guillotine split: right gets FULL height, bottom gets piece width only
          if (TW - slabW > 0) groupTiles[slabTileIdx].spaces.push({ x: slabW, y: 0, w: TW - slabW, h: TH });
          if (TH - slabH > 0) groupTiles[slabTileIdx].spaces.push({ x: 0, y: slabH, w: slabW, h: TH - slabH });
        }
        
        // Place waterfalls with same orientation (wfW_extend × wfH_common)
        [leftWf, rightWf].filter(Boolean).forEach(wf => {
          const wfFound = findSpace(wfW_extend, wfH_common);
          
          if (wfFound) {
            const wfPiece = createPiece(wf, wfFound.x, wfFound.y, wfW_extend, wfH_common, wfFound.tileIdx, true);
            pieces.push(wfPiece);
            piecesByKey[`${wf.elementId}_${wf.key}`] = wfPiece;
            useSpace(wfFound.tileIdx, wfFound.spaceIdx, wfFound.x, wfFound.y, wfW_extend, wfH_common);
          } else {
            const newIdx = createTile();
            const wfPiece = createPiece(wf, 0, 0, wfW_extend, wfH_common, newIdx, true);
            wfPiece.exceeds = wfW_extend > TW || wfH_common > TH;
            pieces.push(wfPiece);
            piecesByKey[`${wf.elementId}_${wf.key}`] = wfPiece;
            groupTiles[newIdx].spaces = [];
            // Guillotine split: right gets FULL height, bottom gets piece width only
            if (TW - wfW_extend > 0) groupTiles[newIdx].spaces.push({ x: wfW_extend, y: 0, w: TW - wfW_extend, h: TH });
            if (TH - wfH_common > 0) groupTiles[newIdx].spaces.push({ x: 0, y: wfH_common, w: wfW_extend, h: TH - wfH_common });
          }
        });
      }
    });
    
    // Process standalone pieces
    const standalone = standaloneByGroup[gKey] || [];
    standalone.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    
    standalone.forEach(p => {
      const pieceKey = `${p.elementId}_${p.key}`;
      
      // Skip if this piece is already fixed
      if (fixedPieces[pieceKey]?.isManual) {
        return; // Skip - already placed as fixed
      }
      
      const pieceW = p.grainLengthwise ? p.w : p.h;
      const pieceH = p.grainLengthwise ? p.h : p.w;
      
      const found = findSpace(pieceW, pieceH);
      
      if (found) {
        const piece = createPiece(p, found.x, found.y, pieceW, pieceH, found.tileIdx);
        pieces.push(piece);
        piecesByKey[`${p.elementId}_${p.key}`] = piece;
        useSpace(found.tileIdx, found.spaceIdx, found.x, found.y, pieceW, pieceH);
      } else {
        const newIdx = createTile();
        const piece = createPiece(p, 0, 0, pieceW, pieceH, newIdx);
        piece.exceeds = pieceW > TW || pieceH > TH;
        pieces.push(piece);
        piecesByKey[`${p.elementId}_${p.key}`] = piece;
        groupTiles[newIdx].spaces = [];
        // Guillotine split
        if (TW - pieceW > 0) groupTiles[newIdx].spaces.push({ x: pieceW, y: 0, w: TW - pieceW, h: TH });
        if (TH - pieceH > 0) groupTiles[newIdx].spaces.push({ x: 0, y: pieceH, w: pieceW, h: TH - pieceH });
      }
    });
    
    tiles.push(...groupTiles);
  });
  
  // Filter out empty tiles and reindex pieces
  const tilesWithPieces = [];
  const tileIndexMap = {}; // old index -> new index
  
  tiles.forEach((tile, oldIdx) => {
    const hasPieces = pieces.some(p => p.tileIndex === oldIdx);
    if (hasPieces) {
      tileIndexMap[oldIdx] = tilesWithPieces.length;
      tilesWithPieces.push(tile);
    }
  });
  
  // Update piece tileIndex references
  pieces.forEach(p => {
    if (tileIndexMap[p.tileIndex] !== undefined) {
      p.tileIndex = tileIndexMap[p.tileIndex];
    }
  });
  
  // Update piecesByKey as well
  Object.values(piecesByKey).forEach(p => {
    if (tileIndexMap[p.tileIndex] !== undefined) {
      p.tileIndex = tileIndexMap[p.tileIndex];
    }
  });
  
  return { pieces, tiles: tilesWithPieces, piecesByKey };
}

/**
 * Calculates texture region for a piece - SINGLE SOURCE OF TRUTH for UV mapping.
 * 
 * Coordinate systems:
 * - Tile coords: origin top-left, X right, Y down (like CSS/canvas)
 * - Texture UV: origin bottom-left, U right, V up (Three.js convention)
 * - To convert: v = 1 - (tileY / tileH)
 * 
 * @param {Object} piece - Piece from computeLayout with x, y, pieceW, pieceH, tileW, tileH
 * @returns {Object} { u0, u1, v0, v1, rotation } - UV bounds and optional rotation in radians
 * 
 * For regular pieces (slab, backsplash):
 *   - Direct mapping: piece occupies rectangle at (x, y) with size (pieceW, pieceH)
 *   - No rotation needed
 * 
 * For waterfall pieces:
 *   - In packer: pieceW = waterfallHeight (90), pieceH = slabDepth (60)
 *   - Piece appears horizontal in preview (90 wide × 60 tall)
 *   - In 3D: face is vertical (60 wide × 90 tall when viewed from side)
 *   - Need -90° rotation to align texture correctly
 * 
 * EXAMPLES (tile 320×160):
 * 
 * Example 1: Slab at (0,0) size 200×60
 *   u0 = 0/320 = 0, u1 = 200/320 = 0.625
 *   v0 = 1 - 60/160 = 0.625, v1 = 1 - 0/160 = 1
 *   rotation = 0
 * 
 * Example 2: Waterfall at (200,0) size 90×60
 *   u0 = 200/320 = 0.625, u1 = 290/320 = 0.906
 *   v0 = 1 - 60/160 = 0.625, v1 = 1 - 0/160 = 1
 *   rotation = -Math.PI/2 (for 3D face alignment)
 * 
 * Example 3: Slab at (0,60) size 210×60
 *   u0 = 0/320 = 0, u1 = 210/320 = 0.656
 *   v0 = 1 - 120/160 = 0.25, v1 = 1 - 60/160 = 0.625
 *   rotation = 0
 */
function getTextureRegion(piece) {
  const { x, y, pieceW, pieceH, tileW, tileH, pieceType } = piece;
  
  // Calculate UV bounds
  // U: horizontal, 0=left, 1=right
  // V: vertical, 0=bottom, 1=top (inverted from tile Y)
  const u0 = x / tileW;
  const u1 = (x + pieceW) / tileW;
  const v0 = 1 - (y + pieceH) / tileH;  // bottom of piece in UV
  const v1 = 1 - y / tileH;              // top of piece in UV
  
  // Waterfall needs -90° rotation because:
  // - In packer/preview: piece is horizontal (pieceW=90 wide, pieceH=60 tall)
  // - In 3D side view: face is vertical (60 wide, 90 tall)
  // - Rotation aligns texture grain correctly
  const rotation = pieceType === 'waterfall' ? -Math.PI / 2 : 0;
  
  return { u0, u1, v0, v1, rotation };
}

// ============================================
// GLOBAL STYLES (Custom Scrollbar)
// ============================================

const GlobalStyles = () => (
  <style>{`
    /* Custom Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: #3a3a3a;
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #4a4a4a;
    }
    ::-webkit-scrollbar-corner {
      background: transparent;
    }
    /* Firefox */
    * {
      scrollbar-width: thin;
      scrollbar-color: #3a3a3a transparent;
    }
    /* Tutorial Animations */
    @keyframes tutorialPulse {
      0% { box-shadow: 0 0 0 3px rgba(201,169,98,0.7), 0 0 16px rgba(201,169,98,0.3); }
      50% { box-shadow: 0 0 0 6px rgba(201,169,98,0.4), 0 0 24px rgba(201,169,98,0.15); }
      100% { box-shadow: 0 0 0 3px rgba(201,169,98,0.7), 0 0 16px rgba(201,169,98,0.3); }
    }
    @keyframes tutorialPulseNoBg {
      0% { box-shadow: 0 0 0 3px rgba(201,169,98,0.7), 0 0 16px rgba(201,169,98,0.3); }
      50% { box-shadow: 0 0 0 6px rgba(201,169,98,0.4), 0 0 24px rgba(201,169,98,0.15); }
      100% { box-shadow: 0 0 0 3px rgba(201,169,98,0.7), 0 0 16px rgba(201,169,98,0.3); }
    }
    @keyframes tutorialFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes tutorialSpotlightIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `}</style>
);

// ============================================
// STYLES
// ============================================

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  background: '#1a1a1a',
  backgroundColor: '#1a1a1a', // Explicit for browsers that ignore 'background'
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
  userSelect: 'text',
  WebkitAppearance: 'none', // Remove default browser styling
  MozAppearance: 'none',
  appearance: 'none',
};

const buttonStyle = {
  padding: '10px 20px',
  background: '#c9a962',
  color: '#0a0a0a',
  border: 'none',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle = {
  ...buttonStyle,
  background: '#2a2a2a',
  color: '#fff',
};

// ============================================
// TUTORIAL STEPS (module-level constant)
// ============================================

const EXAMPLE_PROJECT_DATA = {
  elements: [{"id": "vgdp8hvnp", "name": "Blat", "type": "island", "depth": 60, "height": 90, "length": 320, "cutouts": [{"id": "wrjubqqiv", "name": "Chiuvetă simplă", "type": "rectangle", "width": 50, "center": {"x": 0, "z": -5}, "height": 40, "preset": "sink-single", "radius": null, "cornerRadius": 1}, {"id": "k62s7jzqe", "name": "Baterie Ø32mm", "type": "circle", "width": null, "center": {"x": 0, "z": 20}, "height": null, "preset": "tap-32", "radius": 1.6, "cornerRadius": 0}, {"id": "wpo6ovw4v", "name": "Plită 70cm", "type": "rectangle", "width": 70, "center": {"x": 115, "z": 0}, "height": 49, "preset": "hob-70", "radius": null, "cornerRadius": 3}], "material": "xv8o1fe9n", "position": {"x": 2.1999999999999993, "z": 0.3}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 90}, {"id": "mik334bbh", "name": "Contrablat", "type": "backsplash", "depth": 2, "height": 60, "length": 320, "cutouts": [{"id": "2kpjlnd7m", "name": "Priză simplă", "type": "rectangle", "width": 8, "center": {"x": 84, "z": 0}, "height": 8, "preset": "outlet-single", "radius": null, "cornerRadius": 1}, {"id": "2hxerzp9q", "name": "Priză triplă", "type": "rectangle", "width": 22, "center": {"x": -79, "z": 0}, "height": 8, "preset": "outlet-triple", "radius": null, "cornerRadius": 1}], "material": "xv8o1fe9n", "position": {"x": 2.1999999999999993, "z": 0.006000000000000061}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 90}, {"id": "bl0ngiaus", "name": "Blat", "type": "island", "depth": 60, "height": 90, "length": 200, "material": "qwkzlhjni", "position": {"x": 5.400000000000001, "z": 0.3}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 90}, {"id": "tc79vm3g3", "name": "Contrablat", "type": "backsplash", "depth": 2, "height": 60, "length": 200, "material": "qwkzlhjni", "position": {"x": 5.400000000000001, "z": 0.006000000000000005}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 90}, {"id": "k3dfyn4jn", "name": "Blat", "type": "island", "depth": 90, "height": 90, "length": 140, "material": "nero-marquina", "position": {"x": 2.1999999999999993, "z": 2.125413821024247}, "rotation": 0, "thickness": 12, "waterfallLeft": true, "waterfallRight": true, "placementHeight": 90}, {"id": "jg6txn32d", "name": "Corp mobilier", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 90, "position": {"x": 0.9000000000000001, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "huwo5oe69", "name": "Corp mobilier (copie)", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 60, "height": 90, "drawers": 0, "position": {"x": 1.5000000000000002, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "22xxyivsv", "name": "c6", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 80, "height": 90, "drawers": 2, "position": {"x": 2.1999999999999993, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "xtu1ovno4", "name": "c4", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 90, "height": 90, "drawers": 2, "position": {"x": 3.3499999999999996, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "2b3ayzbtw", "name": "c5", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 30, "height": 90, "position": {"x": 2.749999999999999, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "5b9kvf81n", "name": "c3", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 250, "position": {"x": 4.100000000000001, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "kvwv8e3b5", "name": "c8", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 60, "height": 250, "drawers": 3, "position": {"x": 0.3, "z": 0.3}, "rotation": 90, "placementHeight": 0}, {"id": "frpu9jjzm", "name": "c7", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 90, "position": {"x": 0.3, "z": 0.9}, "rotation": 90, "placementHeight": 0}, {"id": "bu8s5h4x2", "name": "Corp mobilier", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 90, "position": {"x": 0.3, "z": 1.5}, "rotation": 90, "placementHeight": 0}, {"id": "ux50k5kf4", "name": "Corp mobilier (22", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 250, "position": {"x": 0.3, "z": 2.1}, "rotation": 90, "placementHeight": 0}, {"id": "wb5jszmip", "name": "C1", "type": "cabinet", "color": "#8B4513", "depth": 35, "width": 60, "height": 100, "position": {"x": 0.175, "z": 0.9}, "rotation": 90, "placementHeight": 150}, {"id": "5gkrs47eb", "name": "C2", "type": "cabinet", "color": "#8B4513", "depth": 35, "width": 60, "height": 100, "position": {"x": 0.175, "z": 1.5}, "rotation": 90, "placementHeight": 150}, {"id": "lgzm2fh4f", "name": "Blat", "type": "island", "depth": 60, "height": 90, "length": 120, "material": "xv8o1fe9n", "position": {"x": 0.3, "z": 1.2}, "rotation": 90, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "grainLengthwise": true, "placementHeight": 90}, {"id": "f9vzgpcbl", "name": "Corp mobilier (3)", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 90, "position": {"x": 2.5999999999999996, "z": 2.0377164497268523}, "rotation": 180, "placementHeight": 0}, {"id": "y3aay77u0", "name": "Corp mobilier (4)", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 60, "height": 90, "position": {"x": 1.799999999999999, "z": 2.0377164497268523}, "rotation": 180, "placementHeight": 0}, {"id": "mb7e9c1pq", "name": "Contrablat", "type": "backsplash", "depth": 2, "height": 60, "length": 120, "material": "xv8o1fe9n", "position": {"x": 0.006, "z": 1.2}, "rotation": 90, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 90}, {"id": "dfyxukn38", "name": "Contrablat (2)", "type": "backsplash", "depth": 2, "height": 160, "length": 60, "material": "xv8o1fe9n", "position": {"x": 0.3, "z": 0.606}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "grainLengthwise": false, "placementHeight": 90}, {"id": "ill9e8b8h", "name": "Contrablat (3)", "type": "backsplash", "depth": 2, "height": 160, "length": 60, "material": "xv8o1fe9n", "position": {"x": 0.3, "z": 1.794}, "rotation": 180, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "grainLengthwise": false, "placementHeight": 90}, {"id": "6yl6ebnlr", "name": "c4 (2)", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 90, "height": 90, "drawers": 2, "position": {"x": 4.850000000000001, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "v8ycl8anp", "name": "c4 (3)", "type": "cabinet", "color": "#8B4513", "depth": 60, "doors": 0, "width": 90, "height": 90, "drawers": 2, "position": {"x": 5.950000000000001, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "5grpuk4jv", "name": "c5 (2)", "type": "cabinet", "color": "#8B4513", "depth": 60, "width": 20, "height": 90, "position": {"x": 5.400000000000001, "z": 0.3}, "rotation": 0, "placementHeight": 0}, {"id": "2fsk8uwca", "name": "Contrablat", "type": "backsplash", "depth": 2, "height": 45, "length": 140, "material": "nero-marquina", "position": {"x": 2.1999999999999993, "z": 2.3437164497268523}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 0}, {"id": "2djorltbn", "name": "Contrablat (4)", "type": "backsplash", "depth": 2, "height": 45, "length": 140, "material": "nero-marquina", "position": {"x": 2.1999999999999993, "z": 2.3437164497268523}, "rotation": 0, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "placementHeight": 45}, {"id": "mvhlu9u9z", "name": "Contrablat (5)", "type": "backsplash", "depth": 2, "height": 90, "length": 25, "material": "nero-marquina", "position": {"x": 1.5059999999999985, "z": 2.450413821024247}, "rotation": 90, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "grainLengthwise": false, "placementHeight": 0}, {"id": "6hy4tou0s", "name": "Contrablat (6)", "type": "backsplash", "depth": 2, "height": 90, "length": 25, "material": "nero-marquina", "position": {"x": 2.8999999999999986, "z": 2.444635697444425}, "rotation": -90, "thickness": 12, "waterfallLeft": false, "waterfallRight": false, "grainLengthwise": false, "placementHeight": 0}],
  groups: {"0zr06dhbo": {"position": {"x": 1.0499999999999998, "z": 1.4999999999999998}, "rotation": 0}, "qob0c5dty": {"position": {"x": 2.2, "z": 0.0945212805190172}, "rotation": 0}},
  manualLayoutPositions: {"mik334bbh_main": {"x": 0, "y": 0, "pieceH": 60, "pieceW": 320, "rotated": false, "isManual": true, "tileIndex": 0}, "vgdp8hvnp_main": {"x": 0, "y": 60, "pieceH": 60, "pieceW": 320, "rotated": false, "isManual": true, "tileIndex": 0}},
};

const TUTORIAL_STEPS = [
  {
    type: 'modal',
    title: 'Bine ai venit în Configurator! 👋',
    text: 'Hai să facem un tur rapid. Vei învăța să creezi blaturi, contrablaturi, să le modifici și să adaugi decupaje.',
    buttonText: 'Hai să începem →',
  },
  {
    type: 'spotlight', target: 'add-blat',
    title: 'Pasul 1: Adaugă un Blat',
    text: 'Click pe butonul „+ Blat" pentru a adăuga primul element.',
    tasks: [{ key: 'added-blat', label: 'Adaugă un blat' }],
    passthrough: 'target', padding: 6,
  },
  {
    type: 'spotlight', target: 'properties-panel',
    title: 'Pasul 2: Proprietăți',
    text: 'Aici modifici dimensiunile, materialul, grosimea și direcția fibrei.',
    tasks: [{ key: 'changed-dimension', label: 'Modifică o dimensiune' }],
    passthrough: 'all', padding: 0, position: 'left',
  },
  {
    type: 'spotlight', target: 'add-contrablat',
    title: 'Pasul 3: Adaugă un Contrablat',
    text: 'Panoul vertical care se montează pe perete, deasupra blatului.',
    tasks: [{ key: 'added-contrablat', label: 'Adaugă un contrablat' }],
    passthrough: 'target', padding: 6,
  },
  {
    type: 'spotlight', target: 'footer',
    title: 'Pasul 4: Încadrarea pe Plăci',
    text: 'Observă secțiunea de jos — aici se calculează automat câte plăci de ceramică ai nevoie.\n\nBlatul (12mm) și contrablatul (6mm) au grosimi diferite, deci apar pe plăci separate. Fiecare material și grosime generează propriul plan de tăiere.',
    buttonText: 'Am înțeles →',
    padding: 0, position: 'top',
  },
  {
    type: 'spotlight', target: 'canvas-3d',
    title: 'Pasul 5: Controlează Camera',
    text: 'Învață să navighezi în scenă:',
    tasks: [
      { key: 'orbited-camera', label: 'Orbită cameră (Middle-click + drag)' },
      { key: 'zoomed-camera', label: 'Zoom (Scroll)' },
      { key: 'panned-camera', label: 'Pan cameră (Right-click + drag)' },
    ],
    passthrough: 'all', padding: 0, position: 'top-left',
  },
  {
    type: 'spotlight', target: 'canvas-3d',
    title: 'Pasul 6: Mută și Rotește',
    text: 'Selectează un element, apasă tasta G sau R (o singură apăsare, nu ține apăsat), apoi trage cu mouse-ul:',
    tasks: [
      { key: 'moved-element', label: 'Apasă G, apoi drag pentru a muta' },
      { key: 'rotated-element', label: 'Apasă R, apoi drag pentru a roti' },
    ],
    passthrough: 'all', padding: 0, position: 'top-left',
  },
  {
    type: 'spotlight', target: 'canvas-3d',
    title: 'Pasul 7: Decupaje',
    text: 'Selectează un blat din scenă, apoi adaugă un decupaj din panoul de proprietăți.',
    tasks: [
      { key: 'selected-blat', label: 'Selectează un blat', target: 'canvas-3d' },
      { key: 'added-cutout', label: 'Adaugă un decupaj', target: 'properties-panel', scrollTo: 'cutouts-section' },
    ],
    passthrough: 'all', padding: 4, position: 'top-left',
    fixedTooltip: true,
  },
  {
    type: 'spotlight', target: 'canvas-3d',
    title: 'Pasul 8: Grupează / Degrupează',
    text: 'Selectează 2+ elemente cu Ctrl+Click, grupează-le, apoi degrupează.',
    tasks: [
      { key: 'multi-selected', label: 'Selectează 2+ elemente (Ctrl+Click)' },
      { key: 'created-group', label: 'Grupează (Ctrl+G)' },
      { key: 'ungrouped', label: 'Degrupează (Ctrl+X)' },
    ],
    passthrough: 'all', padding: 0, position: 'top-right',
    fixedTooltip: 'top-right',
  },
  {
    type: 'spotlight', target: 'footer',
    title: 'Pasul 9: Cerere de Ofertă',
    text: 'Când ai terminat configurația, apasă butonul „Ofertă" pentru a trimite o cerere de preț. Vei primi oferta pe email.',
    buttonText: 'Am înțeles →',
    padding: 0, position: 'top',
  },
  {
    type: 'modal',
    title: 'Ești gata! 🎉',
    text: 'Scurtături utile:\n• G = Mută  •  R = Rotește  •  D = Duplică\n• Delete = Șterge  •  Ctrl+Z = Anulează\n• Ctrl+G = Grupează  •  Ctrl+X = Degrupează\n• Ctrl+Click = Selecție multiplă\n\nPoți relua tutorial-ul oricând din butonul ❓.',
    buttonText: 'Închide',
    isFinal: true,
  },
];

// ============================================
// TUTORIAL OVERLAY COMPONENT (memoized — never re-renders from parent)
// ============================================

function computeTooltipPos(spotRect, step, posOverride) {
  if (!spotRect) return {};
  const W = 340, H = 200, gap = 16;
  const vW = window.innerWidth, vH = window.innerHeight;
  let pl = posOverride || step.position || 'auto';

  // Fixed corner positions — tooltip sits in a corner, doesn't block the center
  if (pl === 'top-left') {
    return { position: 'fixed', width: W, zIndex: 10003,
      top: spotRect.top + gap, left: spotRect.left + gap,
    };
  }
  if (pl === 'top-right') {
    return { position: 'fixed', width: W, zIndex: 10003,
      top: spotRect.top + gap, left: spotRect.left + spotRect.width - W - gap,
    };
  }
  if (pl === 'center') {
    return { position: 'fixed', width: W, zIndex: 10003,
      top: Math.max(12, spotRect.top + spotRect.height / 2 - H / 2),
      left: Math.max(12, Math.min(spotRect.left + spotRect.width / 2 - W / 2, vW - W - 12)),
    };
  }
  if (pl === 'auto') {
    if (vH - (spotRect.top + spotRect.height) >= H + gap) pl = 'bottom';
    else if (spotRect.top >= H + gap) pl = 'top';
    else if (vW - (spotRect.left + spotRect.width) >= W + gap) pl = 'right';
    else pl = 'left';
  }
  const s = { position: 'fixed', width: W, zIndex: 10003 };
  const cx = Math.max(12, Math.min(spotRect.left + spotRect.width / 2 - W / 2, vW - W - 12));
  const cy = Math.max(12, Math.min(spotRect.top + spotRect.height / 2 - H / 2, vH - H - 12));
  if (pl === 'bottom') { s.top = spotRect.top + spotRect.height + gap; s.left = cx; }
  else if (pl === 'top') { s.top = spotRect.top - H - gap; s.left = cx; }
  else if (pl === 'right') { s.top = cy; s.left = spotRect.left + spotRect.width + gap; }
  else { s.top = cy; s.left = spotRect.left - W - gap; }
  return s;
}

const TutorialOverlay = React.memo(function TutorialOverlay({ step: stepIndex, actions, onClose, onAdvance, onBack }) {
  const [spotRect, setSpotRect] = useState(null);
  const prevTargetRef = useRef(null);

  const stepData = TUTORIAL_STEPS[stepIndex] || null;

  // Determine active target: first incomplete task's target, or step default
  const { activeTarget, activeScrollTo, activePosition } = useMemo(() => {
    if (!stepData) return { activeTarget: null, activeScrollTo: null, activePosition: null };
    let target = stepData.target;
    let scrollTo = null; // null sau selector string
    let position = null;
    if (stepData.tasks) {
      for (const task of stepData.tasks) {
        if (!actions[task.key] && task.target) {
          target = task.target;
          scrollTo = task.scrollTo || null;
          position = task.position || null;
          break;
        }
      }
      // Dacă toate task-urile cu target sunt gata, folosește ultimul target
      if (stepData.tasks.every(t => !t.target || actions[t.key])) {
        const lastWithTarget = [...stepData.tasks].reverse().find(t => t.target);
        if (lastWithTarget) {
          target = lastWithTarget.target;
          position = lastWithTarget.position || null;
        }
      }
    }
    return { activeTarget: target, activeScrollTo: scrollTo, activePosition: position };
  }, [stepIndex, actions, stepData]);

  // Măsoară spotlight rect — re-măsoară când activeTarget se schimbă
  useEffect(() => {
    if (!stepData || stepData.type !== 'spotlight' || !activeTarget) {
      setSpotRect(null);
      prevTargetRef.current = null;
      return;
    }

    const needsScroll = activeScrollTo && prevTargetRef.current !== activeTarget;

    const measure = () => {
      const el = document.querySelector(`[data-tutorial="${activeTarget}"]`);
      if (!el) return;

      // Scroll la un element specific din container (ex: cutouts-section în properties-panel)
      if (needsScroll) {
        const scrollTarget = typeof activeScrollTo === 'string' 
          ? document.querySelector(`[data-tutorial="${activeScrollTo}"]`)
          : el;
        if (scrollTarget) {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      prevTargetRef.current = activeTarget;

      const r = el.getBoundingClientRect();
      const pad = stepData.padding || 4;
      setSpotRect({
        top: Math.round(r.top - pad),
        left: Math.round(r.left - pad),
        width: Math.round(r.width + pad * 2),
        height: Math.round(r.height + pad * 2),
      });
    };

    const raf = requestAnimationFrame(() => {
      if (needsScroll) {
        setTimeout(measure, 400);
      } else {
        measure();
      }
    });
    const onResize = () => requestAnimationFrame(measure);
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [stepIndex, activeTarget]);

  // Early return DUPĂ hook-uri (regulă React)
  if (!stepData) return null;

  const isAll = stepData.passthrough === 'all';
  const isTarget = stepData.passthrough === 'target';
  const hasTasks = stepData.tasks && stepData.tasks.length > 0;
  const allDone = hasTasks && stepData.tasks.every(t => actions[t.key]);

  const handleNext = () => {
    if (stepData.isFinal) onClose(true);
    else onAdvance();
  };

  // Step dots (shared between modal and spotlight)
  const dots = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginTop: '14px' }}>
      {TUTORIAL_STEPS.map((_, i) => (
        <div key={i} style={{
          width: i === stepIndex ? '16px' : '5px', height: '5px', borderRadius: '3px',
          background: i === stepIndex ? '#c9a962' : i < stepIndex ? '#c9a96266' : '#333',
          transition: 'all 0.3s ease',
        }} />
      ))}
    </div>
  );

  // ---- MODAL ----
  if (stepData.type === 'modal') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #c9a962', borderRadius: '16px', padding: '32px 36px', maxWidth: '440px', width: '90%' }}>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#fff', marginBottom: '16px' }}>{stepData.title}</div>
          <div style={{ fontSize: '14px', color: '#aaa', lineHeight: 1.7, whiteSpace: 'pre-line', marginBottom: '28px' }}>{stepData.text}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => onClose(true)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '12px', padding: '8px 0' }}>Închide tutorial</button>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {stepIndex > 0 && (
                <button onClick={onBack} style={{ padding: '10px 18px', background: '#2a2a2a', color: '#888', border: '1px solid #333', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>← Înapoi</button>
              )}
              <button onClick={handleNext} style={{ padding: '10px 24px', background: '#c9a962', color: '#0a0a0a', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>{stepData.buttonText}</button>
            </div>
          </div>
          {dots}
        </div>
      </div>
    );
  }

  // ---- SPOTLIGHT ----
  let tooltipStyle;
  if (stepData.fixedTooltip) {
    const canvasEl = document.querySelector('[data-tutorial="canvas-3d"]');
    const W = 340;
    if (canvasEl) {
      const cr = canvasEl.getBoundingClientRect();
      if (stepData.fixedTooltip === 'top-right') {
        tooltipStyle = { position: 'fixed', width: W, zIndex: 10003, top: cr.top + 16, left: cr.right - W - 16 };
      } else {
        tooltipStyle = { position: 'fixed', width: W, zIndex: 10003, top: cr.top + 16, left: cr.left + 16 };
      }
    } else {
      tooltipStyle = { position: 'fixed', width: W, zIndex: 10003, top: 80, left: 16 };
    }
  } else {
    tooltipStyle = computeTooltipPos(spotRect, stepData, activePosition);
  }

  return (
    <>
      {/* Dark backdrop with cutout hole for spotlight */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)',
        pointerEvents: isAll ? 'none' : 'auto',
        clipPath: spotRect
          ? `polygon(evenodd,
              0 0, 100% 0, 100% 100%, 0 100%, 0 0,
              ${spotRect.left}px ${spotRect.top}px,
              ${spotRect.left + spotRect.width}px ${spotRect.top}px,
              ${spotRect.left + spotRect.width}px ${spotRect.top + spotRect.height}px,
              ${spotRect.left}px ${spotRect.top + spotRect.height}px,
              ${spotRect.left}px ${spotRect.top}px
            )`
          : undefined,
      }} onClick={e => { if (!isAll) e.stopPropagation(); }} />

      {/* Pulsing spotlight border */}
      {spotRect && (
        <div style={{
          position: 'fixed', top: spotRect.top, left: spotRect.left, width: spotRect.width, height: spotRect.height,
          borderRadius: '8px', zIndex: isAll ? 9999 : 10001, pointerEvents: 'none',
          animation: isAll ? 'tutorialPulseNoBg 2s ease-in-out infinite' : 'tutorialPulse 2s ease-in-out infinite',
        }} />
      )}

      {/* Click-through zone for target passthrough */}
      {isTarget && spotRect && (
        <div style={{
          position: 'fixed', top: spotRect.top, left: spotRect.left, width: spotRect.width, height: spotRect.height,
          zIndex: 10002, pointerEvents: 'auto', cursor: 'pointer', background: 'transparent',
        }} onClick={() => {
          const el = document.querySelector(`[data-tutorial="${stepData.target}"]`);
          if (el) el.click();
        }} />
      )}

      {/* Tooltip card */}
      <div style={{ ...tooltipStyle, background: '#1a1a1a', border: '1px solid #c9a962', borderRadius: '12px', padding: '20px 24px', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#c9a962' }}>{stepData.title}</div>
          <button onClick={() => onClose(true)} style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: '18px', padding: '0 0 0 12px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: '13px', color: '#aaa', lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: '14px' }}>{stepData.text}</div>
        
        {hasTasks && (
          <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {stepData.tasks.map(task => {
              const done = !!actions[task.key];
              return (
                <div key={task.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <div style={{
                    width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                    border: done ? '2px solid #4a9962' : '2px solid #444',
                    background: done ? 'rgba(74,153,98,0.15)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'border 0.3s, background 0.3s',
                  }}>
                    {done && <span style={{ color: '#4a9962', fontSize: '13px', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ color: done ? '#4a9962' : '#888', transition: 'color 0.3s' }}>{task.label}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => onClose(true)} style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: '11px', padding: '4px 0' }}>Închide tutorial</button>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {stepIndex > 0 && (
              <button onClick={onBack} style={{ padding: '7px 12px', background: '#2a2a2a', color: '#888', border: '1px solid #333', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>← Înapoi</button>
            )}
            {hasTasks && !allDone && (
              <button onClick={handleNext} style={{ padding: '7px 12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>
                Sari peste →
              </button>
            )}
            {(allDone || !hasTasks) && (
              <button onClick={handleNext} style={{ padding: '8px 16px', background: '#c9a962', color: '#0a0a0a', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                {stepData.buttonText || 'Continuă →'}
              </button>
            )}
          </div>
        </div>
        {dots}
      </div>
    </>
  );
});

const generateId = () => Math.random().toString(36).substr(2, 9);

// ============================================
// DEFAULT LIBRARY DATA
// ============================================

const DEFAULT_LIBRARY = {
  materialTypes: [
    { id: 'ceramic', name: 'Ceramică', icon: '◆' },
    { id: 'quartz', name: 'Quartz', icon: '◇' },
    { id: 'compact', name: 'Compact', icon: '■' },
  ],
  manufacturers: [
    { id: 'neolith', name: 'Neolith', materialType: 'ceramic' },
    { id: 'atlasplan', name: 'AtlasPlan', materialType: 'ceramic' },
    { id: 'dekton', name: 'Dekton', materialType: 'ceramic' },
    { id: 'silestone', name: 'Silestone', materialType: 'quartz' },
    { id: 'caesarstone', name: 'Caesarstone', materialType: 'quartz' },
    { id: 'egger', name: 'Egger', materialType: 'compact' },
  ],
  colors: [
    { id: 'neolith-nero', name: 'Nero Marquina', manufacturer: 'neolith', color: '#1a1a1a', accent: '#3a3a3a' },
    { id: 'neolith-estatuario', name: 'Estatuario', manufacturer: 'neolith', color: '#f5f5f5', accent: '#888888' },
    { id: 'neolith-iron-grey', name: 'Iron Grey', manufacturer: 'neolith', color: '#4a4a4a', accent: '#666666' },
    { id: 'atlasplan-carrara', name: 'Carrara', manufacturer: 'atlasplan', color: '#eeeeee', accent: '#cccccc' },
    { id: 'atlasplan-onyx', name: 'Onyx', manufacturer: 'atlasplan', color: '#3d3d3d', accent: '#555555' },
    { id: 'atlasplan-pietra', name: 'Pietra Grey', manufacturer: 'atlasplan', color: '#5c5c5c', accent: '#777777' },
    { id: 'dekton-trilium', name: 'Trilium', manufacturer: 'dekton', color: '#2a2a2a', accent: '#c9a962' },
    { id: 'silestone-white', name: 'Eternal White', manufacturer: 'silestone', color: '#ffffff', accent: '#cccccc' },
    { id: 'caesarstone-concrete', name: 'Fresh Concrete', manufacturer: 'caesarstone', color: '#8c8c8c', accent: '#aaaaaa' },
    { id: 'egger-white', name: 'Premium White', manufacturer: 'egger', color: '#ffffff', accent: '#eeeeee' },
    { id: 'egger-oak', name: 'Natural Oak', manufacturer: 'egger', color: '#c4a574', accent: '#d4b584' },
  ],
  formats: [
    // Neolith Nero Marquina
    { id: 'f1', colorId: 'neolith-nero', thickness: 6, length: 320, width: 150 },
    { id: 'f2', colorId: 'neolith-nero', thickness: 12, length: 320, width: 160 },
    { id: 'f3', colorId: 'neolith-nero', thickness: 20, length: 320, width: 160 },
    // Neolith Estatuario
    { id: 'f4', colorId: 'neolith-estatuario', thickness: 6, length: 320, width: 150 },
    { id: 'f5', colorId: 'neolith-estatuario', thickness: 12, length: 320, width: 160 },
    { id: 'f6', colorId: 'neolith-estatuario', thickness: 20, length: 320, width: 160 },
    // AtlasPlan Carrara
    { id: 'f7', colorId: 'atlasplan-carrara', thickness: 12, length: 320, width: 160 },
    { id: 'f8', colorId: 'atlasplan-carrara', thickness: 20, length: 320, width: 160 },
    // Dekton Trilium
    { id: 'f9', colorId: 'dekton-trilium', thickness: 12, length: 320, width: 144 },
    { id: 'f10', colorId: 'dekton-trilium', thickness: 20, length: 320, width: 144 },
    // Silestone Eternal White
    { id: 'f11', colorId: 'silestone-white', thickness: 20, length: 320, width: 159 },
    { id: 'f12', colorId: 'silestone-white', thickness: 30, length: 320, width: 159 },
  ],
  inductionSystems: [
    { id: 'ind-hob-60', name: 'Plită inductie 60cm', type: 'rectangle', width: 56, height: 49, depth: 50, minFront: 5, minBack: 5, icon: '🔥' },
    { id: 'ind-hob-70', name: 'Plită inductie 70cm', type: 'rectangle', width: 65, height: 49, depth: 50, minFront: 5, minBack: 5, icon: '🔥' },
    { id: 'ind-hob-80', name: 'Plită inductie 80cm', type: 'rectangle', width: 75, height: 49, depth: 50, minFront: 5, minBack: 5, icon: '🔥' },
    { id: 'ind-hob-90', name: 'Plită inductie 90cm', type: 'rectangle', width: 85, height: 49, depth: 50, minFront: 5, minBack: 5, icon: '🔥' },
    { id: 'ind-eye', name: 'Ochi inductie electrocasnic', type: 'circle', radius: 11, depth: 30, minFront: 3, minBack: 3, icon: '⭕' },
    { id: 'ind-charger', name: 'Punct încărcare telefon', type: 'circle', radius: 5, depth: 15, minFront: 3, minBack: 3, icon: '📱' },
  ],
};

// ============================================
// STORAGE HELPERS
// ============================================

const loadLibrary = () => {
  try {
    const saved = localStorage.getItem('eblat_material_library');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return DEFAULT_LIBRARY;
};

const saveLibrary = (library) => {
  localStorage.setItem('eblat_material_library', JSON.stringify(library));
};

const loadProjects = (userId) => {
  try {
    const saved = localStorage.getItem(`eblat_projects_${userId}`);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
};

const saveProjects = (userId, projects) => {
  localStorage.setItem(`eblat_projects_${userId}`, JSON.stringify(projects));
};

// ============================================
// SUPABASE CONFIG
// ============================================

// Supabase configuration
const SUPABASE_URL = 'https://zokrapacoywipmmincuh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpva3JhcGFjb3l3aXBtbWluY3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MjMwNTEsImV4cCI6MjA4NDQ5OTA1MX0.EEtrMG8L1yj-nyj7U0dy9g68zjhlE7qCc4m5866n48Y';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Check if user is admin - any @e-blat.com email is admin, or user_metadata.isAdmin, or profile.is_admin
const isAdminEmail = (email) => {
  if (!email) return false;
  return email.endsWith('@e-blat.com') || email.endsWith('@atelierazimut.com');
};

// ============================================
// AUTH SYSTEM (Supabase)
// ============================================

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Transform Supabase user to app user format
  const transformUser = (supabaseUser, profile = null) => {
    if (!supabaseUser) return null;
    return {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name: profile?.name || supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0],
      phone: profile?.phone || supabaseUser.user_metadata?.phone || null,
      isAdmin: isAdminEmail(supabaseUser.email) || 
               supabaseUser.user_metadata?.isAdmin === true || 
               profile?.is_admin === true,
    };
  };

  // Fetch user profile from profiles table
  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('name, phone, is_admin')
        .eq('id', userId)
        .single();
      return data;
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    // Timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      console.log('Session timeout - no session found');
      setLoading(false);
    }, 5000);

    // Get initial session
    console.log('Checking for existing session...');
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        clearTimeout(timeout);
        console.log('Session check result:', session ? 'Found session' : 'No session');
        if (session?.user) {
          console.log('User found:', session.user.email);
          const profile = await fetchProfile(session.user.id);
          setUser(transformUser(session.user, profile));
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Session error:', err);
        clearTimeout(timeout);
        setLoading(false);
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      if (session?.user) {
        console.log('Setting user from auth change...');
        // Set user immediately without waiting for profile
        const basicUser = transformUser(session.user, null);
        setUser(basicUser);
        setLoading(false);
        clearTimeout(timeout);
        
        // Then fetch profile in background
        fetchProfile(session.user.id).then(profile => {
          if (profile) {
            setUser(transformUser(session.user, profile));
          }
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        console.error('Login error:', error);
        return { user: null, error: error.message };
      }
      
      if (data.user) {
        const profile = await fetchProfile(data.user.id);
        const appUser = transformUser(data.user, profile);
        setUser(appUser);
        return { user: appUser, error: null };
      }
      
      return { user: null, error: 'Eroare la autentificare' };
    } catch (err) {
      console.error('Login exception:', err);
      return { user: null, error: err.message };
    }
  };

  const signUp = async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });
    
    if (error) {
      return { user: null, error: error.message };
    }
    
    // Create profile entry
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        name: name,
        is_admin: isAdminEmail(email),
      });
    }
    
    return { user: data.user, error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

const useAuth = () => useContext(AuthContext);

// ============================================
// LOGIN PAGE
// ============================================

function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Completează toate câmpurile');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setLoading(false);
  };

  const handleSignUp = async () => {
    if (!email || !password || !name) {
      setError('Completează toate câmpurile');
      return;
    }
    if (password.length < 6) {
      setError('Parola trebuie să aibă minim 6 caractere');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    const { error } = await signUp(email, password, name);
    if (error) {
      setError(error);
    } else {
      setSuccess('Cont creat cu succes! Verifică email-ul pentru confirmare.');
      setMode('login');
    }
    setLoading(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      mode === 'login' ? handleLogin() : handleSignUp();
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ width: '100%', maxWidth: '380px', padding: '40px', background: '#111', borderRadius: '12px', border: '1px solid #2a2a2a' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '32px', fontWeight: 300, color: '#fff' }}>
            e-blat<span style={{ color: '#c9a962' }}>.com</span>
          </div>
          <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>Configurator Blaturi 3D</div>
        </div>

        {/* Toggle Login/Signup */}
        <div style={{ display: 'flex', marginBottom: '24px', background: '#0a0a0a', borderRadius: '8px', padding: '4px' }}>
          <button
            onClick={() => { setMode('login'); setError(''); }}
            style={{
              flex: 1,
              padding: '10px',
              border: 'none',
              borderRadius: '6px',
              background: mode === 'login' ? '#c9a962' : 'transparent',
              color: mode === 'login' ? '#000' : '#666',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            Conectare
          </button>
          <button
            onClick={() => { setMode('signup'); setError(''); }}
            style={{
              flex: 1,
              padding: '10px',
              border: 'none',
              borderRadius: '6px',
              background: mode === 'signup' ? '#c9a962' : 'transparent',
              color: mode === 'signup' ? '#000' : '#666',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            Înregistrare
          </button>
        </div>

        {mode === 'signup' && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' }}>Nume</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              onKeyPress={handleKeyPress} 
              placeholder="Numele tău" 
              style={inputStyle} 
            />
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' }}>Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            onKeyPress={handleKeyPress} 
            placeholder="email@exemplu.ro" 
            style={inputStyle} 
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' }}>Parolă</label>
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            onKeyPress={handleKeyPress} 
            placeholder={mode === 'signup' ? 'Minim 6 caractere' : '••••••••'} 
            style={inputStyle} 
          />
        </div>

        {error && (
          <div style={{ padding: '12px', background: 'rgba(201, 98, 98, 0.1)', border: '1px solid #c96262', borderRadius: '6px', color: '#c96262', fontSize: '13px', marginBottom: '20px' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ padding: '12px', background: 'rgba(98, 201, 98, 0.1)', border: '1px solid #62c962', borderRadius: '6px', color: '#62c962', fontSize: '13px', marginBottom: '20px' }}>
            {success}
          </div>
        )}

        <button 
          onClick={mode === 'login' ? handleLogin : handleSignUp} 
          disabled={loading} 
          style={{ ...buttonStyle, width: '100%', padding: '14px', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Se procesează...' : (mode === 'login' ? 'Conectare' : 'Creează cont')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// PROJECTS PAGE
// ============================================

function ProjectsPage({ onSelectProject, onOpenLibrary }) {
  const { user, signOut, supabase } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState(null);
  const duplicateTimestamps = useRef([]); // anti-spam: track last copy times
  const exampleCreatedRef = useRef(false);

  // Load projects from Supabase
  useEffect(() => {
    if (!user) return;
    
    const fetchProjects = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false });
        
        if (error) throw error;
        
        // Dacă user-ul nu are niciun proiect și nu am creat deja exemplul
        if ((!data || data.length === 0) && !exampleCreatedRef.current) {
          exampleCreatedRef.current = true;
          const exampleProject = {
            user_id: user.id,
            name: 'Proiect exemplu',
            description: 'Beneficiar: Ion Popescu',
            elements: EXAMPLE_PROJECT_DATA.elements,
            groups: EXAMPLE_PROJECT_DATA.groups,
            manual_layout_positions: EXAMPLE_PROJECT_DATA.manualLayoutPositions,
          };
          
          try {
            const { data: newProject, error: insertError } = await supabase
              .from('projects')
              .insert(exampleProject)
              .select()
              .single();
            
            if (insertError) throw insertError;
            setProjects([newProject]);
          } catch (insertErr) {
            console.error('Error creating example project:', insertErr);
            setProjects([]);
          }
        } else {
          setProjects(data);
        }
      } catch (err) {
        console.error('Error loading projects:', err);
        // Fallback to localStorage
        setProjects(loadProjects(user.id));
      }
      setLoading(false);
    };
    
    fetchProjects();
  }, [user, supabase]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    if (projects.length >= 30) {
      alert('Limită atinsă: maxim 30 de proiecte.');
      return;
    }
    
    const project = {
      user_id: user.id,
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || null,
      elements: [],
    };
    
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert(project)
        .select()
        .single();
      
      if (error) throw error;
      setProjects([data, ...projects]);
    } catch (err) {
      console.error('Error creating project:', err);
      // Fallback to localStorage
      const localProject = {
        ...project,
        id: Date.now().toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const updated = [localProject, ...projects];
      setProjects(updated);
      saveProjects(user.id, updated);
    }
    
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectDescription('');
  };

  const deleteProject = async (id) => {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting project:', err);
    }
    
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    setDeleteConfirm(null);
  };

  const duplicateProject = async (project) => {
    // Verificări
    if (projects.length >= 30) {
      alert('Limită atinsă: maxim 30 de proiecte.');
      setDuplicateConfirm(null);
      return;
    }
    
    // Rate limiting: max 5 copii pe minut
    const now = Date.now();
    duplicateTimestamps.current = duplicateTimestamps.current.filter(t => now - t < 60000);
    if (duplicateTimestamps.current.length >= 5) {
      alert('Prea multe copieri. Așteaptă un minut.');
      setDuplicateConfirm(null);
      return;
    }
    duplicateTimestamps.current.push(now);
    
    const duplicate = {
      user_id: user.id,
      name: `${project.name} (copie)`,
      description: project.description,
      elements: project.elements || [],
    };
    
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert(duplicate)
        .select()
        .single();
      
      if (error) throw error;
      setProjects([data, ...projects]);
    } catch (err) {
      console.error('Error duplicating project:', err);
      const localDuplicate = {
        ...duplicate,
        id: Date.now().toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setProjects([localDuplicate, ...projects]);
    }
    setDuplicateConfirm(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', fontFamily: 'system-ui', color: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '20px', fontWeight: 300 }}>
          e-blat<span style={{ color: '#c9a962' }}>.com</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#888' }}>
            {user?.isAdmin && <span style={{ color: '#c9a962', marginRight: '4px' }}>⚙️</span>}
            👤 {user?.name || user?.email}
          </span>
          {user?.isAdmin && (
            <button onClick={onOpenLibrary} style={secondaryBtnStyle}>📚 Librărie</button>
          )}
          <button onClick={signOut} style={{ ...secondaryBtnStyle, color: '#c96262' }}>Deconectare</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 400 }}>Proiectele Mele</h1>
            <p style={{ margin: '8px 0 0', color: '#666', fontSize: '14px' }}>
              {loading ? 'Se încarcă...' : `${projects.length} proiecte`}
            </p>
          </div>
          <button onClick={() => setShowNewProject(true)} style={buttonStyle}>+ Proiect Nou</button>
        </div>

        {/* New Project Modal */}
        {showNewProject && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#111', padding: '24px', borderRadius: '12px', width: '100%', maxWidth: '450px', border: '1px solid #333' }}>
              <h2 style={{ margin: '0 0 24px', color: '#c9a962', fontSize: '18px' }}>Proiect Nou</h2>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' }}>Nume Proiect *</label>
                <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="ex: Bucătărie Familie Popescu" style={inputStyle} autoFocus />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' }}>Descriere (opțional)</label>
                <input type="text" value={newProjectDescription} onChange={e => setNewProjectDescription(e.target.value)} placeholder="ex: Client Ion Popescu, București" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button onClick={() => setShowNewProject(false)} style={secondaryBtnStyle}>Anulează</button>
                <button onClick={createProject} disabled={!newProjectName.trim()} style={{ ...buttonStyle, opacity: newProjectName.trim() ? 1 : 0.4 }}>Creează</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Modal */}
        {deleteConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
            <div style={{ background: '#111', padding: '24px', borderRadius: '12px', maxWidth: '400px', border: '1px solid #333', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
              <h3 style={{ margin: '0 0 12px', color: '#fff' }}>Ștergi proiectul?</h3>
              <p style={{ color: '#888', marginBottom: '24px', fontSize: '14px' }}>
                <strong style={{ color: '#c9a962' }}>{deleteConfirm.name}</strong>
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={() => setDeleteConfirm(null)} style={secondaryBtnStyle}>Anulează</button>
                <button onClick={() => deleteProject(deleteConfirm.id)} style={{ ...buttonStyle, background: '#c96262' }}>Șterge</button>
              </div>
            </div>
          </div>
        )}

        {/* Duplicate Confirm Modal */}
        {duplicateConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
            <div style={{ background: '#111', padding: '24px', borderRadius: '12px', maxWidth: '400px', border: '1px solid #333', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>📋</div>
              <h3 style={{ margin: '0 0 12px', color: '#fff' }}>Copiezi proiectul?</h3>
              <p style={{ color: '#888', marginBottom: '8px', fontSize: '14px' }}>
                <strong style={{ color: '#c9a962' }}>{duplicateConfirm.name}</strong>
              </p>
              <p style={{ color: '#555', marginBottom: '24px', fontSize: '12px' }}>
                Se va crea o copie cu toate elementele.
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={() => setDuplicateConfirm(null)} style={secondaryBtnStyle}>Anulează</button>
                <button onClick={() => duplicateProject(duplicateConfirm)} style={buttonStyle}>Copiază</button>
              </div>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', background: '#111', borderRadius: '12px', border: '1px dashed #2a2a2a' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>📁</div>
            <div style={{ fontSize: '18px', color: '#888', marginBottom: '24px' }}>Niciun proiect încă</div>
            <button onClick={() => setShowNewProject(true)} style={buttonStyle}>+ Creează Primul Proiect</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            {projects.map(project => (
              <div key={project.id} style={{ background: '#111', borderRadius: '12px', border: '1px solid #2a2a2a', overflow: 'hidden' }}>
                <div onClick={() => onSelectProject(project)} style={{ height: '100px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  {project.elements?.length > 0 ? (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', color: '#c9a962' }}>{project.elements.length}</div>
                      <div style={{ fontSize: '11px', color: '#666' }}>elemente</div>
                    </div>
                  ) : (
                    <div style={{ color: '#444', fontSize: '12px' }}>Click pentru a deschide</div>
                  )}
                </div>
                <div style={{ padding: '16px' }}>
                  <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '4px' }}>{project.name}</div>
                  {project.description && <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{project.description}</div>}
                  <div style={{ fontSize: '11px', color: '#555' }}>{new Date(project.updated_at || project.updatedAt).toLocaleDateString('ro-RO')}</div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
                    <button onClick={() => onSelectProject(project)} style={{ ...buttonStyle, flex: 1, padding: '8px', fontSize: '12px' }}>Deschide</button>
                    <button onClick={() => setDuplicateConfirm(project)} style={{ ...secondaryBtnStyle, padding: '8px', fontSize: '12px' }}>📋</button>
                    <button onClick={() => setDeleteConfirm(project)} style={{ ...secondaryBtnStyle, padding: '8px', fontSize: '12px', color: '#c96262' }}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// MATERIAL LIBRARY
// ============================================

function MaterialLibrary({ onClose }) {
  const { supabase } = useAuth();
  const [library, setLibrary] = useState(loadLibrary);
  const [activeTab, setActiveTab] = useState('catalog');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState(null);
  const [newItem, setNewItem] = useState({});
  const [editingItem, setEditingItem] = useState(null);
  const [editedItem, setEditedItem] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [uploadingTexture, setUploadingTexture] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef(null);

  // Load library from Supabase on mount
  useEffect(() => {
    const fetchLibrary = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('library')
          .select('*')
          .eq('id', 'main')
          .single();
        
        if (error) throw error;
        
        if (data) {
          const loadedLibrary = {
            materialTypes: data.material_types || DEFAULT_LIBRARY.materialTypes,
            manufacturers: data.manufacturers || DEFAULT_LIBRARY.manufacturers,
            colors: data.colors || DEFAULT_LIBRARY.colors,
            formats: data.formats || DEFAULT_LIBRARY.formats,
            inductionSystems: data.induction_systems || DEFAULT_LIBRARY.inductionSystems,
          };
          setLibrary(loadedLibrary);
          // Also save to localStorage as cache
          saveLibrary(loadedLibrary);
        }
      } catch (err) {
        console.error('Error loading library:', err);
        // Use localStorage fallback
      }
      setLoading(false);
    };
    
    fetchLibrary();
  }, [supabase]);

  // Save library to Supabase (debounced)
  const saveLibraryToSupabase = useCallback(async (lib) => {
    if (!supabase) return;
    
    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounce save by 1 second
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      
      try {
        const { error } = await supabase
          .from('library')
          .update({
            material_types: lib.materialTypes,
            manufacturers: lib.manufacturers,
            colors: lib.colors,
            formats: lib.formats,
            induction_systems: lib.inductionSystems,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'main');
        
        if (error) throw error;
        setSaveStatus('saved');
      } catch (err) {
        console.error('Error saving library:', err);
        setSaveStatus('error');
      }
      
      setTimeout(() => setSaveStatus(null), 2000);
    }, 1000);
  }, [supabase]);

  // Save to both localStorage and Supabase when library changes
  useEffect(() => {
    if (loading) return; // Don't save during initial load
    
    saveLibrary(library);
    saveLibraryToSupabase(library);
  }, [library, loading, saveLibraryToSupabase]);

  // Upload texture to Supabase Storage
  const uploadTexture = async (file, colorName) => {
    if (!supabase) {
      console.error('Supabase not available');
      return null;
    }
    
    setUploadingTexture(true);
    try {
      // Generate unique filename
      const ext = file.name.split('.').pop();
      const fileName = `${colorName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${ext}`;
      
      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('Texturi materiale')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (error) {
        console.error('Upload error:', error);
        alert('Eroare la upload: ' + error.message);
        return null;
      }
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('Texturi materiale')
        .getPublicUrl(fileName);
      
      return publicUrl;
    } catch (err) {
      console.error('Upload error:', err);
      alert('Eroare la upload textură');
      return null;
    } finally {
      setUploadingTexture(false);
    }
  };

  const updateLibrary = (key, value) => setLibrary({ ...library, [key]: value });

  const addItem = (tab, item) => {
    const newItemWithId = { ...item, id: generateId() };
    
    // Special handling for colors - also create the format
    if (tab === 'colors' && item.formatLength && item.formatWidth && item.thickness) {
      const colorId = newItemWithId.id;
      const formatItem = {
        id: generateId(),
        colorId: colorId,
        thickness: item.thickness,
        length: item.formatLength,
        width: item.formatWidth
      };
      
      // Remove format fields from color item
      const { formatLength, formatWidth, thickness, ...colorData } = newItemWithId;
      
      // Update both colors and formats
      setLibrary(prev => ({
        ...prev,
        colors: [...prev.colors, colorData],
        formats: [...prev.formats, formatItem]
      }));
    } else {
      updateLibrary(tab, [...library[tab], newItemWithId]);
    }
    
    setShowAddModal(false);
    setNewItem({});
    setAddMode(null);
  };

  const updateItem = (tab, id, updates) => {
    updateLibrary(tab, library[tab].map(item => item.id === id ? { ...item, ...updates } : item));
    setEditingItem(null);
  };

  // Archive item instead of deleting (for colors)
  const archiveItem = (tab, id) => {
    if (tab === 'colors') {
      // Archive color - keep it but mark as archived
      updateLibrary(tab, library[tab].map(item => 
        item.id === id ? { ...item, archived: true } : item
      ));
    } else {
      // For other items, delete directly (or could implement archive for all)
      updateLibrary(tab, library[tab].filter(item => item.id !== id));
    }
    setDeleteConfirm(null);
  };

  // Permanently delete item (only for archived items)
  const permanentDeleteItem = (tab, id) => {
    updateLibrary(tab, library[tab].filter(item => item.id !== id));
    setDeleteConfirm(null);
  };

  // Restore archived item
  const restoreItem = (tab, id) => {
    updateLibrary(tab, library[tab].map(item => 
      item.id === id ? { ...item, archived: false } : item
    ));
  };

  // Legacy alias for compatibility
  const deleteItem = archiveItem;

  const tabs = [
    { id: 'materialTypes', label: 'Tipuri Material' },
    { id: 'catalog', label: 'Catalog Complet' },
    { id: 'inductionSystems', label: 'Sisteme Inductie' },
    { id: 'archive', label: 'Arhivă' },
  ];

  const handleExport = () => {
    const dataStr = JSON.stringify(library, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = 'material-library.json';
    link.click();
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          setLibrary(JSON.parse(event.target.result));
        } catch (err) {
          alert('Eroare la import');
        }
      };
      reader.readAsText(file);
    }
  };

  // Render Material Types Tab
  const renderMaterialTypes = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {library.materialTypes.map(type => (
        <div key={type.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#1a1a1a', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: '24px' }}>{type.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{type.name}</div>
            <div style={{ fontSize: '11px', color: '#666' }}>{library.manufacturers.filter(m => m.materialType === type.id).length} producători</div>
          </div>
          <button onClick={() => { setEditedItem({...type}); setEditingItem({ tab: 'materialTypes', item: type }); }} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}>Editează</button>
          <button onClick={() => setDeleteConfirm({ tab: 'materialTypes', id: type.id, name: type.name })} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px', color: '#c96262' }}>×</button>
        </div>
      ))}
      <button onClick={() => { setNewItem({}); setShowAddModal(true); }} style={{ ...secondaryBtnStyle, padding: '12px', borderStyle: 'dashed', marginTop: '8px' }}>+ Adaugă Tip Material</button>
    </div>
  );

  // Render Induction Systems Tab
  const [editingInduction, setEditingInduction] = useState(null);
  const [newInduction, setNewInduction] = useState(null);
  
  const saveInductionItem = (item) => {
    const systems = library.inductionSystems || [];
    if (editingInduction) {
      updateLibrary('inductionSystems', systems.map(s => s.id === item.id ? item : s));
      setEditingInduction(null);
    } else {
      updateLibrary('inductionSystems', [...systems, { ...item, id: Math.random().toString(36).substr(2, 9) }]);
      setNewInduction(null);
    }
  };
  
  const deleteInductionItem = (id) => {
    updateLibrary('inductionSystems', (library.inductionSystems || []).filter(s => s.id !== id));
  };

  const renderInductionForm = (item, onSave, onCancel) => (
    <div style={{ padding: '16px', background: '#1a1a1a', borderRadius: '8px', border: '1px solid #c9a962', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Nume</label>
          <input value={item.name || ''} onChange={e => onSave === saveInductionItem ? (editingInduction ? setEditingInduction({ ...item, name: e.target.value }) : setNewInduction({ ...item, name: e.target.value })) : null} style={{ ...inputStyle, padding: '6px' }} />
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Formă</label>
          <select value={item.type || 'rectangle'} onChange={e => editingInduction ? setEditingInduction({ ...item, type: e.target.value }) : setNewInduction({ ...item, type: e.target.value })} style={{ ...inputStyle, padding: '6px' }}>
            <option value="rectangle">Dreptunghi</option>
            <option value="circle">Cerc</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        {item.type === 'circle' ? (
          <div>
            <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Rază (cm)</label>
            <input type="number" value={item.radius || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, radius: +e.target.value }) : setNewInduction({ ...item, radius: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
          </div>
        ) : (<>
          <div>
            <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Lățime (cm)</label>
            <input type="number" value={item.width || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, width: +e.target.value }) : setNewInduction({ ...item, width: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Adâncime (cm)</label>
            <input type="number" value={item.height || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, height: +e.target.value }) : setNewInduction({ ...item, height: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
          </div>
        </>)}
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Extrudare (mm)</label>
          <input type="number" value={item.depth || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, depth: +e.target.value }) : setNewInduction({ ...item, depth: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Min față (cm)</label>
          <input type="number" value={item.minFront || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, minFront: +e.target.value }) : setNewInduction({ ...item, minFront: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Min spate (cm)</label>
          <input type="number" value={item.minBack || 0} onChange={e => editingInduction ? setEditingInduction({ ...item, minBack: +e.target.value }) : setNewInduction({ ...item, minBack: +e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '2px' }}>Icon</label>
          <input value={item.icon || ''} onChange={e => editingInduction ? setEditingInduction({ ...item, icon: e.target.value }) : setNewInduction({ ...item, icon: e.target.value })} style={{ ...inputStyle, padding: '6px' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtnStyle}>Anulează</button>
        <button onClick={() => onSave(item)} style={buttonStyle}>Salvează</button>
      </div>
    </div>
  );

  const renderInductionSystems = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
        Definește preset-urile de sisteme inductie wireless disponibile pentru blaturi. Acestea se montează sub blat (extrudare din fund).
      </div>
      {(library.inductionSystems || []).map(sys => (
        editingInduction?.id === sys.id ? (
          renderInductionForm(editingInduction, saveInductionItem, () => setEditingInduction(null))
        ) : (
          <div key={sys.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#1a1a1a', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: '20px', width: '32px', textAlign: 'center' }}>{sys.icon || '⚡'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: '13px' }}>{sys.name}</div>
              <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                {sys.type === 'circle' ? `Ø${(sys.radius || 0) * 2}cm` : `${sys.width}×${sys.height}cm`}
                {' · '}{sys.depth}mm extrudare
                {' · '}min față {sys.minFront}cm / spate {sys.minBack}cm
              </div>
            </div>
            <button onClick={() => setEditingInduction({ ...sys })} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}>Editează</button>
            <button onClick={() => deleteInductionItem(sys.id)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px', color: '#c96262' }}>×</button>
          </div>
        )
      ))}
      {newInduction ? (
        renderInductionForm(newInduction, saveInductionItem, () => setNewInduction(null))
      ) : (
        <button onClick={() => setNewInduction({ name: '', type: 'rectangle', width: 56, height: 49, depth: 50, minFront: 5, minBack: 5, icon: '⚡' })} style={{ ...secondaryBtnStyle, padding: '12px', borderStyle: 'dashed', marginTop: '8px' }}>+ Adaugă Sistem Inductie</button>
      )}
    </div>
  );

  // Render Catalog Tab (Manufacturers + Colors + Formats per color)
  const [expandedColor, setExpandedColor] = useState(null);
  const [hoveredFormat, setHoveredFormat] = useState(null);
  
  const renderCatalog = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {library.materialTypes.map(type => {
        const typeManufacturers = library.manufacturers.filter(m => m.materialType === type.id);
        if (typeManufacturers.length === 0) return null;
        
        return (
          <div key={type.id}>
            <div style={{ fontSize: '14px', color: '#c9a962', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>{type.icon}</span> {type.name}
            </div>
            
            {typeManufacturers.map(mfr => {
              const mfrColors = library.colors.filter(c => c.manufacturer === mfr.id && !c.archived);
              const archivedCount = library.colors.filter(c => c.manufacturer === mfr.id && c.archived).length;
              
              return (
                <div key={mfr.id} style={{ marginBottom: '16px', marginLeft: '12px', padding: '16px', background: '#111', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '15px' }}>{mfr.name}</div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {mfrColors.length} culori
                        {archivedCount > 0 && <span style={{ color: '#888' }}> ({archivedCount} arhivate)</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => { setNewItem({ manufacturer: mfr.id }); setAddMode('color'); setShowAddModal(true); }} style={{ ...secondaryBtnStyle, fontSize: '11px', padding: '4px 10px' }}>+ Culoare</button>
                      <button onClick={() => { setEditedItem({...mfr}); setEditingItem({ tab: 'manufacturers', item: mfr }); }} style={{ ...secondaryBtnStyle, fontSize: '11px', padding: '4px 10px' }}>Edit</button>
                      <button onClick={() => setDeleteConfirm({ tab: 'manufacturers', id: mfr.id, name: mfr.name })} style={{ ...secondaryBtnStyle, fontSize: '11px', padding: '4px 10px', color: '#c96262' }}>×</button>
                    </div>
                  </div>
                  
                  {mfrColors.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {mfrColors.map(color => {
                        const isExpanded = expandedColor === color.id;
                        const colorFormats = library.formats.filter(f => f.colorId === color.id);
                        
                        // Group formats by thickness
                        const byThickness = {};
                        colorFormats.forEach(f => {
                          if (!byThickness[f.thickness]) byThickness[f.thickness] = [];
                          byThickness[f.thickness].push(f);
                        });
                        const thicknesses = Object.keys(byThickness).map(Number).sort((a, b) => a - b);
                        
                        return (
                          <div key={color.id} style={{ background: '#1a1a1a', borderRadius: '6px', border: isExpanded ? '1px solid #c9a962' : '1px solid #2a2a2a', overflow: 'hidden' }}>
                            {/* Color Header - Clickable */}
                            <div 
                              onClick={() => setExpandedColor(isExpanded ? null : color.id)}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '12px', 
                                padding: '10px 12px', 
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(201,169,98,0.1)' : 'transparent',
                              }}
                            >
                              <div style={{ width: '36px', height: '36px', background: color.texture ? `url(${color.texture}) center/cover` : color.color, borderRadius: '4px', border: '1px solid #333', flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{color.name}</div>
                                <div style={{ fontSize: '10px', color: '#666' }}>
                                  {colorFormats.length > 0 
                                    ? `${thicknesses.length} grosimi • ${colorFormats.length} formate`
                                    : 'Niciun format definit'
                                  }
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <button onClick={(e) => { e.stopPropagation(); setEditedItem({...color}); setEditingItem({ tab: 'colors', item: color }); }} style={{ ...secondaryBtnStyle, fontSize: '10px', padding: '4px 8px' }}>Edit</button>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ tab: 'colors', id: color.id, name: color.name }); }} style={{ ...secondaryBtnStyle, fontSize: '10px', padding: '4px 8px', color: '#c96262' }}>×</button>
                                <span style={{ color: '#666', fontSize: '12px', marginLeft: '4px' }}>{isExpanded ? '▼' : '▶'}</span>
                              </div>
                            </div>
                            
                            {/* Expanded Formats Section */}
                            {isExpanded && (
                              <div 
                                style={{ padding: '12px', borderTop: '1px solid #2a2a2a', background: '#151515' }}
                                onMouseEnter={() => setHoveredFormat(`${color.id}-new`)}
                                onMouseLeave={() => setHoveredFormat(null)}
                              >
                                <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px' }}>
                                  FORMATE DISPONIBILE
                                </div>
                                
                                {thicknesses.length > 0 ? (
                                  <>
                                    {thicknesses.map(thickness => {
                                      const formats = byThickness[thickness];
                                      const sectionKey = `${color.id}-${thickness}`;
                                      const isHovered = hoveredFormat === sectionKey;
                                      
                                      return (
                                        <div 
                                          key={thickness} 
                                          style={{ marginBottom: '10px' }}
                                          onMouseEnter={(e) => { e.stopPropagation(); setHoveredFormat(sectionKey); }}
                                          onMouseLeave={(e) => { e.stopPropagation(); setHoveredFormat(`${color.id}-new`); }}
                                        >
                                          <div style={{ fontSize: '11px', color: '#c9a962', marginBottom: '6px', fontWeight: 500 }}>{thickness}mm</div>
                                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {formats.map(f => (
                                              <div key={f.id} style={{ padding: '5px 10px', background: '#1a1a1a', borderRadius: '4px', border: '1px solid #333', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {f.length}×{f.width}cm
                                                <button 
                                                  onClick={() => setDeleteConfirm({ tab: 'formats', id: f.id, name: `${f.length}×${f.width}cm` })} 
                                                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 }}
                                                >×</button>
                                              </div>
                                            ))}
                                            <button 
                                              onClick={() => { 
                                                setNewItem({ colorId: color.id, manufacturer: mfr.id, thickness: thickness }); 
                                                setAddMode('format'); 
                                                setShowAddModal(true); 
                                              }}
                                              style={{ 
                                                padding: '5px 10px', 
                                                background: 'transparent', 
                                                border: '1px dashed #444', 
                                                borderRadius: '4px', 
                                                color: '#666', 
                                                cursor: 'pointer', 
                                                fontSize: '11px',
                                                opacity: isHovered ? 1 : 0,
                                                transition: 'opacity 0.15s',
                                              }}
                                            >
                                              +
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    
                                    {/* Add new thickness button - appears on hover */}
                                    <button 
                                      onClick={() => { 
                                        setNewItem({ colorId: color.id, manufacturer: mfr.id }); 
                                        setAddMode('format'); 
                                        setShowAddModal(true); 
                                      }}
                                      style={{ 
                                        marginTop: '8px',
                                        padding: '8px 12px', 
                                        background: 'transparent', 
                                        border: '1px dashed #444', 
                                        borderRadius: '4px', 
                                        color: '#666', 
                                        cursor: 'pointer', 
                                        fontSize: '11px',
                                        opacity: hoveredFormat === `${color.id}-new` ? 1 : 0,
                                        transition: 'opacity 0.15s',
                                        width: '100%',
                                      }}
                                    >
                                      + Adaugă grosime nouă
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ padding: '16px', textAlign: 'center', color: '#555', fontSize: '11px', background: '#1a1a1a', borderRadius: '4px' }}>
                                    <div style={{ marginBottom: '8px' }}>Niciun format definit.</div>
                                    <button 
                                      onClick={() => { 
                                        setNewItem({ colorId: color.id, manufacturer: mfr.id }); 
                                        setAddMode('format'); 
                                        setShowAddModal(true); 
                                      }}
                                      style={{ ...secondaryBtnStyle, fontSize: '11px', padding: '6px 12px' }}
                                    >
                                      + Adaugă primul format
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#555', fontSize: '12px', padding: '12px', textAlign: 'center', background: '#1a1a1a', borderRadius: '4px' }}>Nicio culoare</div>
                  )}
                </div>
              );
            })}
            
            <button onClick={() => { setNewItem({ materialType: type.id }); setAddMode('manufacturer'); setShowAddModal(true); }} style={{ ...secondaryBtnStyle, marginLeft: '12px', fontSize: '12px', padding: '8px 16px', borderStyle: 'dashed' }}>
              + Adaugă Producător
            </button>
          </div>
        );
      })}
    </div>
  );

  // Render Archive Tab
  const renderArchive = () => {
    const archivedColors = library.colors.filter(c => c.archived);
    
    if (archivedColors.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#666' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>Arhiva este goală</div>
          <div style={{ fontSize: '13px' }}>Materialele arhivate vor apărea aici</div>
        </div>
      );
    }

    // Group archived colors by manufacturer
    const archivedByMfr = {};
    archivedColors.forEach(color => {
      const mfr = library.manufacturers.find(m => m.id === color.manufacturer);
      const mfrName = mfr?.name || 'Necunoscut';
      if (!archivedByMfr[mfrName]) archivedByMfr[mfrName] = [];
      archivedByMfr[mfrName].push(color);
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ 
          background: 'rgba(201,169,98,0.1)', 
          border: '1px solid rgba(201,169,98,0.3)', 
          borderRadius: '8px', 
          padding: '12px 16px',
          fontSize: '13px',
          color: '#c9a962'
        }}>
          📦 Materialele arhivate rămân disponibile pentru proiectele existente, dar nu pot fi selectate pentru piese noi.
        </div>

        {Object.entries(archivedByMfr).map(([mfrName, colors]) => (
          <div key={mfrName} style={{ background: '#111', borderRadius: '8px', border: '1px solid #2a2a2a', padding: '16px' }}>
            <div style={{ fontWeight: 600, marginBottom: '12px', color: '#888' }}>{mfrName}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {colors.map(color => (
                <div 
                  key={color.id} 
                  style={{ 
                    background: '#1a1a1a', 
                    borderRadius: '8px', 
                    padding: '12px', 
                    border: '1px solid #333',
                    width: '180px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '6px',
                      background: color.texture ? `url(${color.texture}) center/cover` : color.color,
                      border: '1px solid #444',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '13px', color: '#999' }}>{color.name}</div>
                      <div style={{ fontSize: '10px', color: '#555' }}>ID: {color.id}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => restoreItem('colors', color.id)}
                      style={{ 
                        ...secondaryBtnStyle, 
                        flex: 1, 
                        padding: '6px', 
                        fontSize: '11px',
                        color: '#4a9',
                        borderColor: '#4a9',
                      }}
                    >
                      ↩ Restaurează
                    </button>
                    <button 
                      onClick={() => setDeleteConfirm({ 
                        tab: 'colors', 
                        id: color.id, 
                        name: color.name,
                        permanent: true 
                      })}
                      style={{ 
                        ...secondaryBtnStyle, 
                        padding: '6px 10px', 
                        fontSize: '11px',
                        color: '#c96262',
                        borderColor: '#c96262',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render Add Modal
  const renderAddModal = () => {
    const getFields = () => {
      if (activeTab === 'materialTypes') {
        return [
          { key: 'name', label: 'Nume', type: 'text' },
          { key: 'icon', label: 'Icon', type: 'text' },
        ];
      }
      if (activeTab === 'catalog' && addMode === 'manufacturer') {
        return [
          { key: 'name', label: 'Nume Producător', type: 'text' },
        ];
      }
      if (activeTab === 'catalog' && addMode === 'color') {
        // Color requires: name, color, then at least one format, then optional texture
        return [
          { key: 'name', label: 'Nume Culoare', type: 'text' },
          { key: 'color', label: 'Culoare (hex)', type: 'color' },
          { key: 'thickness', label: 'Grosime Format (mm)', type: 'number' },
          { key: 'formatLength', label: 'Lungime Format (cm)', type: 'number' },
          { key: 'formatWidth', label: 'Lățime Format (cm)', type: 'number' },
          { key: 'texture', label: 'Textură (opțional)', type: 'image' },
        ];
      }
      if (addMode === 'format') {
        // For formats, we need thickness and dimensions (length x width of the slab)
        return [
          { key: 'thickness', label: 'Grosime (mm)', type: 'number' },
          { key: 'length', label: 'Lungime (cm)', type: 'number' },
          { key: 'width', label: 'Lățime (cm)', type: 'number' },
        ];
      }
      return [];
    };

    const fields = getFields();
    const getTargetTab = () => {
      if (activeTab === 'materialTypes') return 'materialTypes';
      if (addMode === 'manufacturer') return 'manufacturers';
      if (addMode === 'color') return 'colors';
      if (addMode === 'format') return 'formats';
      return activeTab;
    };

    const isValid = () => {
      if (activeTab === 'materialTypes') return newItem.name?.trim();
      if (addMode === 'manufacturer') return newItem.name?.trim();
      if (addMode === 'color') return newItem.name?.trim() && newItem.thickness && newItem.formatLength && newItem.formatWidth;
      if (addMode === 'format') return newItem.colorId && newItem.thickness && newItem.length && newItem.width;
      return false;
    };

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ background: '#111', padding: '24px', borderRadius: '8px', minWidth: '350px', border: '1px solid #333' }}>
          <h3 style={{ margin: '0 0 20px', color: '#c9a962' }}>Adaugă</h3>
          
          {fields.map(field => (
            <div key={field.key} style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>{field.label}</label>
              {field.type === 'text' && (
                <input type="text" value={newItem[field.key] || ''} onChange={e => setNewItem({ ...newItem, [field.key]: e.target.value })} style={inputStyle} />
              )}
              {field.type === 'number' && (
                <input type="number" value={newItem[field.key] || ''} onChange={e => setNewItem({ ...newItem, [field.key]: parseFloat(e.target.value) })} style={inputStyle} />
              )}
              {field.type === 'color' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="color" value={newItem[field.key] || '#000000'} onChange={e => setNewItem({ ...newItem, [field.key]: e.target.value })} style={{ width: '50px', height: '38px', border: 'none' }} />
                  <input type="text" value={newItem[field.key] || ''} onChange={e => setNewItem({ ...newItem, [field.key]: e.target.value })} style={{ ...inputStyle, flex: 1 }} placeholder="#000000" />
                </div>
              )}
              {field.type === 'image' && (
                <div>
                  {/* For new color, require format dimensions before allowing texture */}
                  {addMode === 'color' && (!newItem.formatLength || !newItem.formatWidth) ? (
                    <div style={{ padding: '12px', background: '#1a1a1a', borderRadius: '4px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
                      Completează mai întâi dimensiunile formatului pentru a putea adăuga o textură
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input 
                          type="file" 
                          accept="image/*"
                          disabled={uploadingTexture}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const colorName = newItem.name || 'texture';
                              const url = await uploadTexture(file, colorName);
                              if (url) {
                                setNewItem({ ...newItem, [field.key]: url });
                              }
                            }
                          }} 
                          style={{ ...inputStyle, padding: '8px', flex: 1 }} 
                        />
                        {newItem[field.key] && (
                          <button onClick={() => setNewItem({ ...newItem, [field.key]: '' })} style={{ ...secondaryBtnStyle, padding: '8px', color: '#c96262' }}>×</button>
                        )}
                      </div>
                      {uploadingTexture && (
                        <div style={{ marginTop: '8px', padding: '8px', background: '#1a1a1a', borderRadius: '4px', color: '#c9a962', fontSize: '12px', textAlign: 'center' }}>
                          ⏳ Se încarcă textura...
                        </div>
                      )}
                      {newItem[field.key] && (
                        <div 
                          style={{ marginTop: '8px', width: '100px', height: '50px', background: `url(${newItem[field.key]}) center/cover`, borderRadius: '4px', border: '1px solid #333' }} 
                          title="Textură încărcată"
                        />
                      )}
                    </>
                  )}
                </div>
              )}
              {field.type === 'select' && (
                <select value={newItem[field.key] || ''} onChange={e => setNewItem({ ...newItem, [field.key]: e.target.value })} style={inputStyle}>
                  <option value="">Selectează...</option>
                  {field.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button onClick={() => { setShowAddModal(false); setNewItem({}); setAddMode(null); }} style={secondaryBtnStyle}>Anulează</button>
            <button onClick={() => isValid() && addItem(getTargetTab(), newItem)} disabled={!isValid()} style={{ ...buttonStyle, opacity: isValid() ? 1 : 0.4 }}>Adaugă</button>
          </div>
        </div>
      </div>
    );
  };

  // Render Edit Modal
  const renderEditModal = () => {
    if (!editingItem) return null;
    const { tab } = editingItem;

    const getFields = () => {
      if (tab === 'materialTypes') return [{ key: 'name', label: 'Nume', type: 'text' }, { key: 'icon', label: 'Icon', type: 'text' }];
      if (tab === 'manufacturers') return [{ key: 'name', label: 'Nume', type: 'text' }];
      if (tab === 'colors') return [
        { key: 'name', label: 'Nume', type: 'text' }, 
        { key: 'color', label: 'Culoare', type: 'color' },
        { key: 'texture', label: 'Textură (opțional)', type: 'image' }
      ];
      return [];
    };

    const fields = getFields();

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ background: '#111', padding: '24px', borderRadius: '8px', minWidth: '350px', border: '1px solid #333' }}>
          <h3 style={{ margin: '0 0 20px', color: '#c9a962' }}>Editează</h3>
          
          {fields.map(field => (
            <div key={field.key} style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>{field.label}</label>
              {field.type === 'text' && (
                <input type="text" value={editedItem[field.key] || ''} onChange={e => setEditedItem({ ...editedItem, [field.key]: e.target.value })} style={inputStyle} />
              )}
              {field.type === 'color' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="color" value={editedItem[field.key] || '#000000'} onChange={e => setEditedItem({ ...editedItem, [field.key]: e.target.value })} style={{ width: '50px', height: '38px', border: 'none' }} />
                  <input type="text" value={editedItem[field.key] || ''} onChange={e => setEditedItem({ ...editedItem, [field.key]: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                </div>
              )}
              {field.type === 'image' && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input 
                      type="file" 
                      accept="image/*"
                      disabled={uploadingTexture}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const colorName = editedItem.name || editingItem.item.name || 'texture';
                          const url = await uploadTexture(file, colorName);
                          if (url) {
                            setEditedItem({ ...editedItem, [field.key]: url });
                          }
                        }
                      }} 
                      style={{ ...inputStyle, padding: '8px', flex: 1 }} 
                    />
                    {editedItem[field.key] && (
                      <button onClick={() => setEditedItem({ ...editedItem, [field.key]: '' })} style={{ ...secondaryBtnStyle, padding: '8px', color: '#c96262' }}>×</button>
                    )}
                  </div>
                  {uploadingTexture && (
                    <div style={{ marginTop: '8px', padding: '8px', background: '#1a1a1a', borderRadius: '4px', color: '#c9a962', fontSize: '12px', textAlign: 'center' }}>
                      ⏳ Se încarcă textura...
                    </div>
                  )}
                  {editedItem[field.key] && (
                    <div 
                      style={{ marginTop: '8px', width: '100px', height: '50px', background: `url(${editedItem[field.key]}) center/cover`, borderRadius: '4px', border: '1px solid #333' }} 
                      title="Textură încărcată"
                    />
                  )}
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button onClick={() => setEditingItem(null)} style={secondaryBtnStyle}>Anulează</button>
            <button onClick={() => updateItem(tab, editingItem.item.id, editedItem)} style={buttonStyle}>Salvează</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}>← Înapoi</button>
          <div>
            <span style={{ fontSize: '18px' }}>e-blat<span style={{ color: '#c9a962' }}>.com</span></span>
            <span style={{ color: '#666', fontSize: '13px', marginLeft: '8px' }}>/ Librărie Materiale</span>
          </div>
          {saveStatus && <span style={{ fontSize: '10px', color: '#4a9' }}>✓ Salvat</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <label style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>
            Import <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button onClick={handleExport} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}>Export</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '12px 24px',
            background: activeTab === tab.id ? '#1a1a1a' : 'transparent',
            color: activeTab === tab.id ? '#c9a962' : '#888',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid #c9a962' : '2px solid transparent',
            cursor: 'pointer',
            fontSize: '13px',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {activeTab === 'materialTypes' && renderMaterialTypes()}
        {activeTab === 'catalog' && renderCatalog()}
        {activeTab === 'inductionSystems' && renderInductionSystems()}
        {activeTab === 'archive' && renderArchive()}
      </div>

      {showAddModal && renderAddModal()}
      {editingItem && renderEditModal()}
      
      {/* Delete/Archive Confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
          <div style={{ background: '#111', padding: '24px', borderRadius: '8px', maxWidth: '400px', border: '1px solid #333', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>{deleteConfirm.permanent ? '🗑️' : '📦'}</div>
            <h3 style={{ margin: '0 0 12px', color: '#fff' }}>{deleteConfirm.permanent ? 'Ștergi permanent?' : 'Arhivezi?'}</h3>
            <p style={{ color: '#888', marginBottom: '8px' }}><strong style={{ color: '#c9a962' }}>{deleteConfirm.name}</strong></p>
            {!deleteConfirm.permanent && deleteConfirm.tab === 'colors' && (
              <p style={{ color: '#666', fontSize: '12px', marginBottom: '24px' }}>
                Materialul va fi mutat în arhivă și va rămâne disponibil pentru proiectele existente.
              </p>
            )}
            {deleteConfirm.permanent && (
              <p style={{ color: '#c96262', fontSize: '12px', marginBottom: '24px' }}>
                ⚠️ Această acțiune este permanentă și nu poate fi anulată!
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button onClick={() => setDeleteConfirm(null)} style={secondaryBtnStyle}>Anulează</button>
              <button 
                onClick={() => deleteConfirm.permanent 
                  ? permanentDeleteItem(deleteConfirm.tab, deleteConfirm.id) 
                  : deleteItem(deleteConfirm.tab, deleteConfirm.id)
                } 
                style={{ ...buttonStyle, background: '#c96262' }}
              >
                {deleteConfirm.permanent ? 'Șterge Permanent' : 'Arhivează'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// NUMERIC INPUT COMPONENT
// ============================================

function NumericInput({ value, onChange, step, style, min, max, precision = 0 }) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);
  
  // Update local value when prop changes (but not while focused)
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(precision > 0 ? Number(value).toFixed(precision) : String(value));
    }
  }, [value, isFocused, precision]);
  
  const handleChange = (e) => {
    setLocalValue(e.target.value);
  };
  
  const commitValue = () => {
    let parsed = parseFloat(localValue);
    if (isNaN(parsed)) parsed = 0;
    if (min !== undefined && parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;
    setLocalValue(precision > 0 ? parsed.toFixed(precision) : String(parsed));
    onChange(parsed);
  };
  
  const handleBlur = () => {
    setIsFocused(false);
    commitValue();
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitValue();
      inputRef.current?.blur();
    }
  };
  
  const handleFocus = (e) => {
    setIsFocused(true);
    e.target.select();
  };
  
  return (
    <input 
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      draggable={false}
      step={step}
      style={style}
    />
  );
}

// ============================================
// CONFIGURATOR 3D (Full version)
// ============================================

function Configurator({ project, onBack }) {
  const { user, supabase } = useAuth();
  
  // State declarations
  const [library, setLibrary] = useState(loadLibrary);
  const [elements, setElementsInternal] = useState(project?.elements || []);
  const [groups, setGroups] = useState(project?.groups || {}); // Group parent transforms
  const [undoHistory, setUndoHistory] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]); // Multi-select support
  const [tool, setTool] = useState('select');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapThreshold, setSnapThreshold] = useState(10); // in cm
  const [saveStatus, setSaveStatus] = useState(null);
  const [snapIndicators, setSnapIndicators] = useState([]); // [{x, z, type}]
  const [marqueeRect, setMarqueeRect] = useState(null); // { left, top, width, height }
  const [texturePreview, setTexturePreview] = useState(null); // { texture: url, name: string }
  const [texturePreviewVisible, setTexturePreviewVisible] = useState(false); // pentru animație fade
  const [materialWarnings, setMaterialWarnings] = useState([]); // Warnings for archived/missing materials
  const [debugTexture, setDebugTexture] = useState(false); // Debug mode: show full texture with transparency
  const [manualLayoutPositions, setManualLayoutPositions] = useState(project?.manual_layout_positions || {}); // Manual piece positions from footer drag
  const [forceRenderKey, setForceRenderKey] = useState(0); // Force re-render of all meshes
  const [selectedCutoutId, setSelectedCutoutId] = useState(null); // Selected cutout for highlighting
  const [selectedInductionId, setSelectedInductionId] = useState(null); // Selected induction system
  const [editingCutoutNameId, setEditingCutoutNameId] = useState(null); // Cutout being renamed
  const [tutorialStep, setTutorialStep] = useState(null); // null = off, 0-8 = active step
  const tutorialElementCountRef = useRef(0); // Track element count for interactive steps
  const tutorialStepRef = useRef(null); // Ref mirror of tutorialStep for use in closures
  
  // Track loaded textures to force re-render only when NEW textures finish loading
  const loadedTexturesCountRef = useRef(0);
  
  // Check periodically if new textures have loaded
  // Note: This runs independently and updates forceRenderKey when textures load
  useEffect(() => {
    let isMounted = true;
    
    const checkInterval = setInterval(() => {
      if (!isMounted) return;
      
      // Count how many textures are fully loaded
      const loadedCount = Array.from(textureCache.values()).filter(t => t.loaded).length;
      
      // If new textures finished loading, force re-render
      if (loadedCount > loadedTexturesCountRef.current) {
        loadedTexturesCountRef.current = loadedCount;
        setForceRenderKey(prev => prev + 1);
      }
    }, 500); // Increased interval to reduce load
    
    return () => {
      isMounted = false;
      clearInterval(checkInterval);
    };
  }, []);

  // Tutorial: Auto-start when opening an empty project (never completed before)
  useEffect(() => {
    if (elements.length === 0 && tutorialStep === null) {
      const key = `eblat_tutorial_completed_${user?.id || 'local'}`;
      if (!localStorage.getItem(key)) {
        const timer = setTimeout(() => setTutorialStep(0), 600);
        return () => clearTimeout(timer);
      }
    }
  }, []); // Only on mount

  // Keep tutorialStepRef in sync for use in closures (commitElementChanges etc.)
  useEffect(() => {
    tutorialStepRef.current = tutorialStep;
  }, [tutorialStep]);

  // Track previous element dimensions to detect changes and invalidate manual positions
  const prevElementDimensionsRef = useRef({});
  
  useEffect(() => {
    // Check if any element dimensions changed - if so, invalidate their manual positions
    const keysToInvalidate = [];
    
    elements.forEach(el => {
      const prev = prevElementDimensionsRef.current[el.id];
      const current = {
        length: el.length,
        depth: el.depth,
        height: el.height,
        grainLengthwise: el.grainLengthwise,
        waterfallLeft: el.waterfallLeft,
        waterfallRight: el.waterfallRight,
        waterfallHeight: el.waterfallHeight,
      };
      
      if (prev && JSON.stringify(prev) !== JSON.stringify(current)) {
        // Dimensions changed - invalidate manual positions for this element
        keysToInvalidate.push(`${el.id}_main`);
        keysToInvalidate.push(`${el.id}_left`);
        keysToInvalidate.push(`${el.id}_right`);
      }
      
      prevElementDimensionsRef.current[el.id] = current;
    });
    
    // Clean up dimensions and manual positions for deleted elements
    const currentElementIds = new Set(elements.map(el => el.id));
    Object.keys(prevElementDimensionsRef.current).forEach(id => {
      if (!currentElementIds.has(id)) {
        delete prevElementDimensionsRef.current[id];
        // Also invalidate manual positions for deleted elements
        keysToInvalidate.push(`${id}_main`);
        keysToInvalidate.push(`${id}_left`);
        keysToInvalidate.push(`${id}_right`);
      }
    });
    
    if (keysToInvalidate.length > 0) {
      setManualLayoutPositions(prev => {
        const newPositions = { ...prev };
        keysToInvalidate.forEach(key => {
          delete newPositions[key];
        });
        return newPositions;
      });
    }
  }, [elements]);
  
  // Reset selected cutout when element selection changes
  useEffect(() => {
    setSelectedCutoutId(null);
    setSelectedInductionId(null);
  }, [selectedIds]);
  
  // Helper for single selection (backward compatibility)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = (id) => setSelectedIds(id ? [id] : []);
  
  // Helper functions for group transforms
  const getWorldPosition = (el) => {
    if (!el.groupId || !groups[el.groupId]) {
      return el.position || { x: 0, z: 0 };
    }
    const group = groups[el.groupId];
    const pivotX = group.position?.x || 0;
    const pivotZ = group.position?.z || 0;
    // NEGATIVE angle to match Three.js Y rotation direction
    const groupRot = -(group.rotation || 0) * Math.PI / 180;
    const localX = el.localOffset?.x || 0;
    const localZ = el.localOffset?.z || 0;
    
    // Original world position (when group rotation was 0)
    const origWorldX = pivotX + localX;
    const origWorldZ = pivotZ + localZ;
    
    // Apply Delta rotation around pivot
    const dx = origWorldX - pivotX;
    const dz = origWorldZ - pivotZ;
    
    return {
      x: pivotX + dx * Math.cos(groupRot) - dz * Math.sin(groupRot),
      z: pivotZ + dx * Math.sin(groupRot) + dz * Math.cos(groupRot)
    };
  };
  
  const getWorldRotation = (el) => {
    if (!el.groupId || !groups[el.groupId]) {
      return el.rotation || 0;
    }
    return (el.localRotation || 0) + (groups[el.groupId].rotation || 0);
  };
  
  // Load library from Supabase
  useEffect(() => {
    const fetchLibrary = async () => {
      if (!supabase) return;
      
      try {
        const { data, error } = await supabase
          .from('library')
          .select('*')
          .eq('id', 'main')
          .single();
        
        if (error) throw error;
        
        if (data) {
          const loadedLibrary = {
            materialTypes: data.material_types || DEFAULT_LIBRARY.materialTypes,
            manufacturers: data.manufacturers || DEFAULT_LIBRARY.manufacturers,
            colors: data.colors || DEFAULT_LIBRARY.colors,
            formats: data.formats || DEFAULT_LIBRARY.formats,
            inductionSystems: data.induction_systems || DEFAULT_LIBRARY.inductionSystems,
          };
          setLibrary(loadedLibrary);
          
          // Validate materials in project elements (exclude cabinets which don't use library materials)
          if (project?.elements?.length > 0) {
            const warnings = [];
            project.elements.forEach(el => {
              // Skip cabinets - they use custom color, not library material
              if (el.type === 'cabinet') return;
              
              const color = loadedLibrary.colors.find(c => c.id === el.material);
              if (!color) {
                warnings.push({
                  type: 'missing',
                  elementName: el.name,
                  materialId: el.material,
                });
              } else if (color.archived) {
                warnings.push({
                  type: 'archived',
                  elementName: el.name,
                  materialName: color.name,
                });
              }
            });
            setMaterialWarnings(warnings);
          }
        }
      } catch (err) {
        console.error('Error loading library:', err);
        // Use localStorage fallback (already loaded in initial state)
      }
    };
    
    fetchLibrary();
  }, [supabase, project?.elements]);
  
  // Max undo steps
  const MAX_UNDO_HISTORY = 50;
  
  // Custom setElements that tracks history
  const setElements = useCallback((newElements) => {
    setElementsInternal(prev => {
      const nextElements = typeof newElements === 'function' ? newElements(prev) : newElements;
      // Only add to history if elements actually changed
      if (JSON.stringify(prev) !== JSON.stringify(nextElements)) {
        setUndoHistory(history => {
          const newHistory = [...history, { elements: prev, manualLayoutPositions }];
          // Limit history size
          if (newHistory.length > MAX_UNDO_HISTORY) {
            return newHistory.slice(-MAX_UNDO_HISTORY);
          }
          return newHistory;
        });
      }
      return nextElements;
    });
  }, [manualLayoutPositions]);
  
  // Function to save manual layout positions to undo history
  const pushManualLayoutToHistory = useCallback(() => {
    setUndoHistory(history => {
      const newHistory = [...history, { elements, manualLayoutPositions }];
      if (newHistory.length > MAX_UNDO_HISTORY) {
        return newHistory.slice(-MAX_UNDO_HISTORY);
      }
      return newHistory;
    });
  }, [elements, manualLayoutPositions]);
  
  // Undo function
  const undo = useCallback(() => {
    if (undoHistory.length === 0) return;
    
    const previousState = undoHistory[undoHistory.length - 1];
    setUndoHistory(history => history.slice(0, -1));
    
    // Handle both old format (just elements array) and new format (object with elements and manualLayoutPositions)
    if (Array.isArray(previousState)) {
      // Old format - just elements
      setElementsInternal(previousState);
    } else {
      // New format - object with elements and manualLayoutPositions
      setElementsInternal(previousState.elements);
      if (previousState.manualLayoutPositions !== undefined) {
        setManualLayoutPositions(previousState.manualLayoutPositions);
      }
    }
    setSelectedId(null);
  }, [undoHistory]);
  
  // Keyboard shortcut for undo (Ctrl+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);
  
  // All refs together
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const meshesRef = useRef({});
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, radius: 6 });
  const saveTimeoutRef = useRef(null);
  const prevDebugTextureRef = useRef(debugTexture);
  const prevSelectedCutoutIdRef = useRef(selectedCutoutId);
  const prevSelectedInductionIdRef = useRef(selectedInductionId);
  
  // Refs for pending transforms during drag (persists across re-renders)
  const pendingGroupTransformsRef = useRef({});
  const pendingElementTransformsRef = useRef({});
  const rawPositionsRef = useRef({});
  const rawRotationsRef = useRef({});
  const isDraggingRef = useRef(false); // Flag to prevent useEffect overriding positions during drag

  // Auto-save to Supabase (debounced)
  useEffect(() => {
    if (!project || !user) return;
    
    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounce save by 1 second
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      
      try {
        // Try saving with all fields first
        let { error } = await supabase
          .from('projects')
          .update({ 
            elements,
            groups,
            manual_layout_positions: manualLayoutPositions,
            updated_at: new Date().toISOString() 
          })
          .eq('id', project.id);
        
        // If new columns don't exist, try without them
        if (error?.code === 'PGRST204' || error?.message?.includes('manual_layout_positions')) {
          const result = await supabase
            .from('projects')
            .update({ 
              elements,
              groups,
              updated_at: new Date().toISOString() 
            })
            .eq('id', project.id);
          error = result.error;
          
          // If groups also doesn't exist
          if (error?.code === 'PGRST204') {
            const result2 = await supabase
              .from('projects')
              .update({ 
                elements,
                updated_at: new Date().toISOString() 
              })
              .eq('id', project.id);
            error = result2.error;
          }
        }
        
        if (error) throw error;
        setSaveStatus('saved');
      } catch (err) {
        console.error('Error saving project:', err);
        // Fallback to localStorage
        const updatedProject = { 
          ...project, 
          elements, 
          groups, 
          manual_layout_positions: manualLayoutPositions,
          updated_at: new Date().toISOString() 
        };
        const projects = loadProjects(user.id);
        const updated = projects.map(p => p.id === project.id ? updatedProject : p);
        saveProjects(user.id, updated);
        setSaveStatus('saved (local)');
      }
      
      setTimeout(() => setSaveStatus(null), 2000);
    }, 1000);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [elements, groups, manualLayoutPositions, project, user]);

  // Expose functions to window for 3D interaction
  useEffect(() => {
    window.selectElement = (id, { ctrlKey = false, shiftKey = false } = {}) => {
      handleElementSelect(id, { ctrlKey, shiftKey });
    };
    
    window.deselectAll = () => {
      setSelectedIds([]);
    };
    
    window.getSelectedIds = () => selectedIds;
    
    window.getCurrentTool = () => tool;
    
    window.getSnapThreshold = () => snapThreshold / 100; // Convert cm to meters
    
    // Marquee selection functions
    window.updateMarquee = (rect) => {
      setMarqueeRect(rect);
    };
    
    window.selectByMarquee = (ids, addToSelection) => {
      if (addToSelection) {
        // Add to existing selection
        setSelectedIds(prev => [...new Set([...prev, ...ids])]);
      } else {
        // Replace selection
        setSelectedIds(ids);
      }
    };
    
    // Use refs for pending transforms (persists across re-renders)
    const pendingGroupTransforms = pendingGroupTransformsRef.current;
    const pendingElementTransforms = pendingElementTransformsRef.current;
    const rawPositions = rawPositionsRef.current;
    const rawRotations = rawRotationsRef.current;
    
    // Get the groupId if all selected elements are in the same group
    const getSelectedGroupId = () => {
      const selectedEls = elements.filter(e => selectedIds.includes(e.id));
      if (selectedEls.length === 0) return null;
      
      const groupIds = new Set(selectedEls.map(e => e.groupId).filter(Boolean));
      // If all selected elements are in the same group, return that group
      if (groupIds.size === 1) {
        const groupId = [...groupIds][0];
        // Check if ALL elements in the group are selected
        const groupElements = elements.filter(e => e.groupId === groupId);
        if (groupElements.every(e => selectedIds.includes(e.id))) {
          return groupId;
        }
      }
      return null;
    };
    
    // Helper to get world position during drag (considering pending transforms)
    const getWorldPosDuringDrag = (el) => {
      if (el.groupId && groups[el.groupId]) {
        const pendingGroup = pendingGroupTransforms[el.groupId];
        const pivotX = pendingGroup?.position?.x ?? groups[el.groupId].position?.x ?? 0;
        const pivotZ = pendingGroup?.position?.z ?? groups[el.groupId].position?.z ?? 0;
        // NEGATIVE angle to match Three.js Y rotation direction
        const groupRot = -((pendingGroup?.rotation ?? groups[el.groupId].rotation) || 0) * Math.PI / 180;
        const localX = el.localOffset?.x || 0;
        const localZ = el.localOffset?.z || 0;
        
        // Original world position (when group rotation was 0)
        const origWorldX = pivotX + localX;
        const origWorldZ = pivotZ + localZ;
        
        // Apply Delta rotation around pivot
        const dx = origWorldX - pivotX;
        const dz = origWorldZ - pivotZ;
        
        return {
          x: pivotX + dx * Math.cos(groupRot) - dz * Math.sin(groupRot),
          z: pivotZ + dx * Math.sin(groupRot) + dz * Math.cos(groupRot)
        };
      }
      return pendingElementTransforms[el.id]?.position || el.position || { x: 0, z: 0 };
    };
    
    const getWorldRotDuringDrag = (el) => {
      if (el.groupId && groups[el.groupId]) {
        const pendingGroup = pendingGroupTransforms[el.groupId];
        const groupRot = (pendingGroup?.rotation ?? groups[el.groupId].rotation) || 0;
        return (el.localRotation || 0) + groupRot;
      }
      return pendingElementTransforms[el.id]?.rotation ?? el.rotation ?? 0;
    };
    
    window.moveElement = (id, delta) => {
      isDraggingRef.current = true; // Prevent useEffect from overriding positions
      
      const selectedGroupId = getSelectedGroupId();
      
      if (selectedGroupId && groups[selectedGroupId]) {
        // Moving a group - just update group position
        const group = groups[selectedGroupId];
        const pending = pendingGroupTransforms[selectedGroupId] || { 
          position: { ...group.position }, 
          rotation: group.rotation || 0
        };
        
        const baseX = rawPositions[selectedGroupId]?.x ?? pending.position.x;
        const baseZ = rawPositions[selectedGroupId]?.z ?? pending.position.z;
        let newX = baseX + delta.x;
        let newZ = baseZ + delta.z;
        
        rawPositions[selectedGroupId] = { x: newX, z: newZ };
        
        // Snap group elements to other elements (using 5 snap points)
        if (snapEnabled) {
          const SNAP_THRESHOLD = window.getSnapThreshold?.() || 0.10;
          const snapIndicators = [];
          let snapDeltaX = null, snapDeltaZ = null;
          
          // Get group members with their would-be world positions
          const groupMembers = elements.filter(e => e.groupId === selectedGroupId);
          const tempGroupPos = { x: newX, z: newZ };
          const groupRot = (pending.rotation || 0) * Math.PI / 180;
          
          // Check each group member against non-group elements
          groupMembers.forEach(member => {
            if (snapDeltaX !== null && snapDeltaZ !== null) return;
            
            // Calculate member's would-be world position
            const localX = member.localOffset?.x || 0;
            const localZ = member.localOffset?.z || 0;
            const memberWorldX = tempGroupPos.x + localX * Math.cos(groupRot) - localZ * Math.sin(groupRot);
            const memberWorldZ = tempGroupPos.z + localX * Math.sin(groupRot) + localZ * Math.cos(groupRot);
            
            const memberRot = ((member.localRotation || 0) + (pending.rotation || 0)) % 360;
            const isRotated90 = Math.abs(memberRot % 180 - 90) < 5;
            let memberW = member.length / 100;
            let memberD = member.type === 'backsplash' ? (member.thickness || 12) / 1000 : member.depth / 100;
            if (isRotated90) [memberW, memberD] = [memberD, memberW];
            
            const memberY = (member.placementHeight || 0) / 100;
            
            // Member's snap points: 4 corners + edge centers
            const memberPoints = [
              { x: memberWorldX - memberW / 2, z: memberWorldZ - memberD / 2 },
              { x: memberWorldX + memberW / 2, z: memberWorldZ - memberD / 2 },
              { x: memberWorldX - memberW / 2, z: memberWorldZ + memberD / 2 },
              { x: memberWorldX + memberW / 2, z: memberWorldZ + memberD / 2 },
              { x: memberWorldX, z: memberWorldZ - memberD / 2 },
              { x: memberWorldX, z: memberWorldZ + memberD / 2 },
            ];
            
            elements.forEach(other => {
              if (other.groupId === selectedGroupId) return;
              
              const otherPos = getWorldPosDuringDrag(other);
              const otherRot = (other.rotation ?? 0) % 360;
              const otherIsRotated90 = Math.abs(otherRot % 180 - 90) < 5;
              let otherW = other.length / 100;
              let otherD = other.type === 'backsplash' ? (other.thickness || 12) / 1000 : other.depth / 100;
              if (otherIsRotated90) [otherW, otherD] = [otherD, otherW];
              
              const otherY = (other.placementHeight || 0) / 100;
              const heightDiff = Math.abs(memberY - otherY);
              const snapType = heightDiff > 0.01 ? 'warning' : 'element';
              
              // Other's snap points: 4 corners + edge centers
              const otherPoints = [
                { x: otherPos.x - otherW / 2, z: otherPos.z - otherD / 2 },
                { x: otherPos.x + otherW / 2, z: otherPos.z - otherD / 2 },
                { x: otherPos.x - otherW / 2, z: otherPos.z + otherD / 2 },
                { x: otherPos.x + otherW / 2, z: otherPos.z + otherD / 2 },
                { x: otherPos.x, z: otherPos.z - otherD / 2 },
                { x: otherPos.x, z: otherPos.z + otherD / 2 },
              ];
              
              memberPoints.forEach(mp => {
                otherPoints.forEach(op => {
                  if (snapDeltaX === null && Math.abs(mp.x - op.x) < SNAP_THRESHOLD) {
                    snapDeltaX = op.x - mp.x;
                    snapIndicators.push({ x: op.x, z: (mp.z + op.z) / 2, axis: 'x', y: memberY, type: snapType });
                  }
                  if (snapDeltaZ === null && Math.abs(mp.z - op.z) < SNAP_THRESHOLD) {
                    snapDeltaZ = op.z - mp.z;
                    snapIndicators.push({ x: (mp.x + op.x) / 2, z: op.z, axis: 'z', y: memberY, type: snapType });
                  }
                });
              });
            });
          });
          
          if (snapDeltaX !== null) newX += snapDeltaX;
          if (snapDeltaZ !== null) newZ += snapDeltaZ;
          
          window.updateSnapIndicators?.(snapIndicators);
        }
        
        // Clamp group to work area bounds
        const WORK_LIMIT = 10;
        const groupMembers = elements.filter(e => e.groupId === selectedGroupId);
        let maxExtentX = 0, maxExtentZ = 0;
        const groupRot = ((pending.rotation || 0)) * Math.PI / 180;
        groupMembers.forEach(member => {
          const lx = member.localOffset?.x || 0;
          const lz = member.localOffset?.z || 0;
          const wx = Math.abs(lx * Math.cos(groupRot) - lz * Math.sin(groupRot)) + (member.length / 100) / 2;
          const wz = Math.abs(lx * Math.sin(groupRot) + lz * Math.cos(groupRot)) + (member.type === 'backsplash' ? (member.thickness || 12) / 1000 : member.depth / 100) / 2;
          maxExtentX = Math.max(maxExtentX, wx);
          maxExtentZ = Math.max(maxExtentZ, wz);
        });
        newX = Math.max(maxExtentX, Math.min(WORK_LIMIT - maxExtentX, newX));
        newZ = Math.max(maxExtentZ, Math.min(WORK_LIMIT - maxExtentZ, newZ));
        
        pendingGroupTransforms[selectedGroupId] = { 
          ...pending, 
          position: { x: newX, z: newZ } 
        };
        
        // Update all group member meshes
        elements.filter(e => e.groupId === selectedGroupId).forEach(el => {
          const mesh = meshesRef.current[el.id];
          if (!mesh) return;
          
          const worldPos = getWorldPosDuringDrag(el);
          mesh.position.x = worldPos.x;
          mesh.position.z = worldPos.z;
        });
        
      } else {
        // Moving ungrouped elements or mixed selection
        let snapDeltaX = 0, snapDeltaZ = 0;
        
        selectedIds.forEach((elId, idx) => {
          const mesh = meshesRef.current[elId];
          const el = elements.find(e => e.id === elId);
          if (!mesh || !el || el.groupId) return; // Skip grouped elements
          
          const pending = pendingElementTransforms[elId] || { 
            position: { ...(el.position || { x: 0, z: 0 }) }, 
            rotation: el.rotation || 0 
          };
          
          const baseX = rawPositions[elId]?.x ?? pending.position.x;
          const baseZ = rawPositions[elId]?.z ?? pending.position.z;
          let newX = baseX + delta.x + snapDeltaX;
          let newZ = baseZ + delta.z + snapDeltaZ;
          
          rawPositions[elId] = { x: baseX + delta.x, z: baseZ + delta.z }; // Store raw without snap
          
          // Apply snap for first element only, then propagate to others
          if (idx === 0 && snapEnabled) {
            const SNAP_THRESHOLD = window.getSnapThreshold?.() || 0.10;
            const WALL_SNAP_THRESHOLD = SNAP_THRESHOLD * 2; // Stronger snap for walls at origin
            const snapIndicators = [];
            
            // Get dimensions of moving element
            const elRotation = (pending.rotation || 0) % 360;
            const isRotated90 = Math.abs(elRotation % 180 - 90) < 5;
            let movingWidth, movingDepth;
            if (el.type === 'cabinet') {
              movingWidth = (el.width || 60) / 100;
              movingDepth = (el.depth || 60) / 100;
            } else {
              movingWidth = el.length / 100;
              movingDepth = el.type === 'backsplash' ? (el.thickness || 12) / 1000 : el.depth / 100;
            }
            if (isRotated90) [movingWidth, movingDepth] = [movingDepth, movingWidth];
            
            // Moving element's snap points: 4 corners + edge centers
            // For backsplash, use front/back edges only (no center on thickness axis)
            const movingY = (el.placementHeight || 0) / 100;
            const movingPoints = [
              { x: newX - movingWidth / 2, z: newZ - movingDepth / 2, name: 'FL' },
              { x: newX + movingWidth / 2, z: newZ - movingDepth / 2, name: 'FR' },
              { x: newX - movingWidth / 2, z: newZ + movingDepth / 2, name: 'BL' },
              { x: newX + movingWidth / 2, z: newZ + movingDepth / 2, name: 'BR' },
              { x: newX, z: newZ - movingDepth / 2, name: 'FC' },
              { x: newX, z: newZ + movingDepth / 2, name: 'BC' },
            ];
            
            let snapX = null, snapZ = null;
            const indicatorY = (el.placementHeight || 0) / 100;
            
            // PRIORITY 1: Wall snap - snap element edge to X=0 or Z=0 (room walls)
            // Check if left edge is near X=0
            const leftEdge = newX - movingWidth / 2;
            if (Math.abs(leftEdge) < WALL_SNAP_THRESHOLD) {
              snapX = movingWidth / 2; // Position center so left edge is at X=0
              snapIndicators.push({ x: 0, z: newZ, axis: 'x', y: indicatorY, type: 'grid' });
            }
            // Check if back edge is near Z=0
            const backEdge = newZ - movingDepth / 2;
            if (Math.abs(backEdge) < WALL_SNAP_THRESHOLD) {
              snapZ = movingDepth / 2; // Position center so back edge is at Z=0
              snapIndicators.push({ x: newX, z: 0, axis: 'z', y: indicatorY, type: 'grid' });
            }
            
            // PRIORITY 2: Element snap - if no wall snap, try other elements
            if (snapX === null || snapZ === null) {
              elements.forEach(other => {
                if (selectedIds.includes(other.id)) return;
                
                const otherPos = getWorldPosDuringDrag(other);
                const otherRot = (pendingElementTransforms[other.id]?.rotation ?? other.rotation ?? 0) % 360;
                const otherIsRotated90 = Math.abs(otherRot % 180 - 90) < 5;
                
                let otherWidth, otherDepth;
                if (other.type === 'cabinet') {
                  otherWidth = (other.width || 60) / 100;
                  otherDepth = (other.depth || 60) / 100;
                } else {
                  otherWidth = other.length / 100;
                  otherDepth = other.type === 'backsplash' ? (other.thickness || 12) / 1000 : other.depth / 100;
                }
                if (otherIsRotated90) [otherWidth, otherDepth] = [otherDepth, otherWidth];
                
                // Other element's snap points: 4 corners + edge centers
                const otherY = (other.placementHeight || 0) / 100;
                const otherPoints = [
                  { x: otherPos.x - otherWidth / 2, z: otherPos.z - otherDepth / 2, name: 'FL' },
                  { x: otherPos.x + otherWidth / 2, z: otherPos.z - otherDepth / 2, name: 'FR' },
                  { x: otherPos.x - otherWidth / 2, z: otherPos.z + otherDepth / 2, name: 'BL' },
                  { x: otherPos.x + otherWidth / 2, z: otherPos.z + otherDepth / 2, name: 'BR' },
                  { x: otherPos.x, z: otherPos.z - otherDepth / 2, name: 'FC' },
                  { x: otherPos.x, z: otherPos.z + otherDepth / 2, name: 'BC' },
                ];
                
                // Determine snap type based on height difference
                const heightDiff = Math.abs(movingY - otherY);
                const snapType = heightDiff > 0.01 ? 'warning' : 'element'; // Red if different heights
                
                // Check all point combinations for snap
                movingPoints.forEach(mp => {
                  otherPoints.forEach(op => {
                    // X snap - align X coordinates of any two points
                    if (snapX === null && Math.abs(mp.x - op.x) < SNAP_THRESHOLD) {
                      const deltaX = op.x - mp.x;
                      snapX = newX + deltaX;
                      snapIndicators.push({ 
                        x: op.x, 
                        z: (mp.z + op.z) / 2, 
                        axis: 'x', 
                        y: indicatorY,
                        type: snapType 
                      });
                    }
                    
                    // Z snap - align Z coordinates of any two points
                    if (snapZ === null && Math.abs(mp.z - op.z) < SNAP_THRESHOLD) {
                      const deltaZ = op.z - mp.z;
                      snapZ = newZ + deltaZ;
                      snapIndicators.push({ 
                        x: (mp.x + op.x) / 2, 
                        z: op.z, 
                        axis: 'z', 
                        y: indicatorY,
                        type: snapType 
                      });
                    }
                  });
                });
              });
            }
            
            // Grid snap (if no element snap found) - use blue color
            // Priority: 60cm (kitchen module) > 10cm (fine grid)
            const GRID_60 = 0.6; // 60cm - kitchen module
            const GRID_10 = 0.1; // 10cm - fine grid
            
            if (snapX === null) {
              // Try 60cm grid first (stronger snap)
              const grid60X = Math.round(newX / GRID_60) * GRID_60;
              if (Math.abs(newX - grid60X) < SNAP_THRESHOLD) {
                snapX = grid60X;
                snapIndicators.push({ x: grid60X, z: newZ, axis: 'x', y: indicatorY, type: 'grid' });
              } else {
                // Try 10cm grid
                const grid10X = Math.round(newX / GRID_10) * GRID_10;
                if (Math.abs(newX - grid10X) < SNAP_THRESHOLD / 2) {
                  snapX = grid10X;
                  snapIndicators.push({ x: grid10X, z: newZ, axis: 'x', y: indicatorY, type: 'grid' });
                }
              }
            }
            if (snapZ === null) {
              // Try 60cm grid first
              const grid60Z = Math.round(newZ / GRID_60) * GRID_60;
              if (Math.abs(newZ - grid60Z) < SNAP_THRESHOLD) {
                snapZ = grid60Z;
                snapIndicators.push({ x: newX, z: grid60Z, axis: 'z', y: indicatorY, type: 'grid' });
              } else {
                // Try 10cm grid
                const grid10Z = Math.round(newZ / GRID_10) * GRID_10;
                if (Math.abs(newZ - grid10Z) < SNAP_THRESHOLD / 2) {
                  snapZ = grid10Z;
                  snapIndicators.push({ x: newX, z: grid10Z, axis: 'z', y: indicatorY, type: 'grid' });
                }
              }
            }
            
            if (snapX !== null) {
              snapDeltaX = snapX - newX;
              newX = snapX;
            }
            if (snapZ !== null) {
              snapDeltaZ = snapZ - newZ;
              newZ = snapZ;
            }
            
            // Update visual snap indicators
            window.updateSnapIndicators?.(snapIndicators);
          }
          
          pendingElementTransforms[elId] = { ...pending, position: { x: newX, z: newZ } };
          
          // Clamp to work area bounds (0 to gridSize*2 = 10m)
          const WORK_LIMIT = 10;
          const elRot = (pending.rotation || 0) % 360;
          const isRot90 = Math.abs(elRot % 180 - 90) < 5;
          let clampW = el.length / 100;
          let clampD = el.type === 'backsplash' ? (el.thickness || 12) / 1000 : el.depth / 100;
          if (el.type === 'cabinet') { clampW = (el.width || 60) / 100; clampD = (el.depth || 60) / 100; }
          if (isRot90) [clampW, clampD] = [clampD, clampW];
          newX = Math.max(clampW / 2, Math.min(WORK_LIMIT - clampW / 2, newX));
          newZ = Math.max(clampD / 2, Math.min(WORK_LIMIT - clampD / 2, newZ));
          pendingElementTransforms[elId].position = { x: newX, z: newZ };
          
          mesh.position.x = newX;
          mesh.position.z = newZ;
        });
      }
      
      // Update gizmo position
      if (window.updateGizmoPosition && selectedIds.length > 0) {
        const selectedEls = elements.filter(e => selectedIds.includes(e.id));
        const centerX = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).x, 0) / selectedEls.length;
        const centerZ = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).z, 0) / selectedEls.length;
        const avgY = selectedEls.reduce((sum, e) => {
          const placementHeight = (e.placementHeight || 90) / 100;
          const thickness = (e.thickness || 12) / 1000;
          return sum + placementHeight + thickness;
        }, 0) / selectedEls.length;
        window.updateGizmoPosition(centerX, avgY, centerZ);
      }
    };
    
    window.rotateElement = (id, dx) => {
      isDraggingRef.current = true; // Prevent useEffect from overriding positions
      
      const selectedGroupId = getSelectedGroupId();
      const angleDelta = dx * 0.5; // degrees per pixel
      
      if (selectedGroupId && groups[selectedGroupId]) {
        // Rotating a group using proper Delta * M_world approach
        const group = groups[selectedGroupId];
        const pending = pendingGroupTransforms[selectedGroupId] || { 
          position: { ...group.position }, 
          rotation: group.rotation || 0 
        };
        
        const baseRot = rawRotations[selectedGroupId] ?? pending.rotation;
        let newRot = baseRot + angleDelta;
        
        rawRotations[selectedGroupId] = newRot;
        
        // Apply snap
        if (snapEnabled) {
          newRot = Math.round(newRot / 5) * 5;
        }
        
        pendingGroupTransforms[selectedGroupId] = { ...pending, rotation: newRot };
        
        // Get group center (pivot point in world space)
        const pivotX = pending.position.x;
        const pivotZ = pending.position.z;
        // NEGATIVE angle for position rotation to match Three.js Y rotation direction
        const angleRad = -newRot * Math.PI / 180;
        
        // Update all group member meshes using proper world transform
        elements.filter(e => e.groupId === selectedGroupId).forEach(el => {
          const mesh = meshesRef.current[el.id];
          if (!mesh) return;
          
          const localX = el.localOffset?.x || 0;
          const localZ = el.localOffset?.z || 0;
          const localRot = el.localRotation || 0;
          
          // Original world position (when group rotation was 0)
          const origWorldX = pivotX + localX;
          const origWorldZ = pivotZ + localZ;
          
          // Apply Delta rotation around pivot
          const dx = origWorldX - pivotX;
          const dz = origWorldZ - pivotZ;
          
          const cosR = Math.cos(angleRad);
          const sinR = Math.sin(angleRad);
          
          const newWorldX = pivotX + dx * cosR - dz * sinR;
          const newWorldZ = pivotZ + dx * sinR + dz * cosR;
          
          // Element's world rotation (positive for Three.js Y rotation)
          const newWorldRot = localRot + newRot;
          
          mesh.position.x = newWorldX;
          mesh.position.z = newWorldZ;
          mesh.rotation.y = newWorldRot * Math.PI / 180;
        });
        
      } else if (selectedIds.length === 1) {
        // Single ungrouped element rotation
        const el = elements.find(e => e.id === id);
        if (!el || el.groupId) return;
        
        const mesh = meshesRef.current[id];
        if (!mesh) return;
        
        const pending = pendingElementTransforms[id] || { 
          position: { ...(el.position || { x: 0, z: 0 }) }, 
          rotation: el.rotation || 0 
        };
        
        const baseRot = rawRotations[id] ?? pending.rotation;
        let newRot = baseRot + angleDelta;
        
        rawRotations[id] = newRot;
        
        if (snapEnabled) {
          newRot = Math.round(newRot / 5) * 5;
        }
        
        pendingElementTransforms[id] = { ...pending, rotation: newRot };
        mesh.rotation.y = newRot * Math.PI / 180;
        
      } else {
        // Multiple ungrouped elements - rotate around center (virtual group logic)
        const selectedEls = elements.filter(e => selectedIds.includes(e.id) && !e.groupId);
        if (selectedEls.length === 0) return;
        
        // Calculate and cache initial offsets from center (like group localOffsets)
        if (!window._multiRotatePivot) {
          const cx = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).x, 0) / selectedEls.length;
          const cz = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).z, 0) / selectedEls.length;
          window._multiRotatePivot = { x: cx, z: cz };
          window._multiRotateOffsets = {};
          window._multiRotateBaseRot = {};
          selectedEls.forEach(el => {
            const pos = getWorldPosDuringDrag(el);
            const pending = pendingElementTransforms[el.id] || { 
              position: { ...(el.position || { x: 0, z: 0 }) }, 
              rotation: el.rotation || 0 
            };
            window._multiRotateOffsets[el.id] = { x: pos.x - cx, z: pos.z - cz };
            window._multiRotateBaseRot[el.id] = pending.rotation;
          });
          window._multiRotateAccum = 0;
        }
        
        window._multiRotateAccum += angleDelta;
        let totalAngle = window._multiRotateAccum;
        
        if (snapEnabled) {
          totalAngle = Math.round(totalAngle / 5) * 5;
        }
        
        const pivotX = window._multiRotatePivot.x;
        const pivotZ = window._multiRotatePivot.z;
        // NEGATIVE angle for position rotation (same as group logic)
        const angleRad = -totalAngle * Math.PI / 180;
        
        selectedEls.forEach(el => {
          const mesh = meshesRef.current[el.id];
          if (!mesh) return;
          
          const offset = window._multiRotateOffsets[el.id];
          if (!offset) return;
          
          const cosR = Math.cos(angleRad);
          const sinR = Math.sin(angleRad);
          
          const newX = pivotX + offset.x * cosR - offset.z * sinR;
          const newZ = pivotZ + offset.x * sinR + offset.z * cosR;
          
          // Element rotation (positive, same as group)
          const baseRot = window._multiRotateBaseRot[el.id] || 0;
          const newRot = baseRot + totalAngle;
          rawRotations[el.id] = newRot;
          
          pendingElementTransforms[el.id] = { position: { x: newX, z: newZ }, rotation: newRot };
          mesh.position.x = newX;
          mesh.position.z = newZ;
          mesh.rotation.y = newRot * Math.PI / 180;
        });
      }
    };
    
    // Commit pending changes to React state (called on mouse up)
    window.commitElementChanges = () => {
      let hasChanges = false;
      let hadPositionChanges = false;
      let hadRotationChanges = false;
      let hadGroupChanges = false;
      
      // Commit group transforms
      if (Object.keys(pendingGroupTransforms).length > 0) {
        hasChanges = true;
        hadGroupChanges = true;
        const groupUpdates = { ...pendingGroupTransforms };
        setGroups(prev => {
          const updated = { ...prev };
          Object.entries(groupUpdates).forEach(([groupId, transform]) => {
            if (updated[groupId]) {
              updated[groupId] = { ...updated[groupId], ...transform };
            }
          });
          return updated;
        });
      }
      
      // Commit element transforms (for ungrouped elements)
      if (Object.keys(pendingElementTransforms).length > 0) {
        hasChanges = true;
        // Compare pending transforms against current element state to detect actual changes
        const currentElements = elements; // from closure
        Object.entries(pendingElementTransforms).forEach(([id, pending]) => {
          const orig = currentElements.find(e => e.id === id);
          if (!orig) return;
          const origPos = orig.position || { x: 0, z: 0 };
          if (pending.position && (Math.abs(pending.position.x - origPos.x) > 0.001 || Math.abs(pending.position.z - origPos.z) > 0.001)) {
            hadPositionChanges = true;
          }
          if (pending.rotation !== undefined && Math.abs((pending.rotation || 0) - (orig.rotation || 0)) > 0.1) {
            hadRotationChanges = true;
          }
        });
        const elementUpdates = { ...pendingElementTransforms };
        setElements(prev => prev.map(el => {
          const pending = elementUpdates[el.id];
          if (pending) {
            return { 
              ...el, 
              position: pending.position,
              rotation: pending.rotation 
            };
          }
          return el;
        }));
      }
      
      // Clear refs
      pendingGroupTransformsRef.current = {};
      pendingElementTransformsRef.current = {};
      rawPositionsRef.current = {};
      rawRotationsRef.current = {};
      isDraggingRef.current = false;
      
      // Tutorial: detect move/rotate actions
      if (hasChanges && tutorialStepRef.current !== null) {
        if (hadPositionChanges || hadGroupChanges) {
          tutorialMarkAction('moved-element');
        }
        if (hadRotationChanges) {
          tutorialMarkAction('rotated-element');
        }
      }
    };
    
    return () => {
      delete window.selectElement;
      delete window.deselectAll;
      delete window.getSelectedIds;
      delete window.getCurrentTool;
      delete window.moveElement;
      delete window.rotateElement;
      delete window.commitElementChanges;
    };
  }, [tool, snapEnabled, elements, selectedIds, groups]);

  // 3D Scene Setup
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Lights - soft lighting for depth perception
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    
    // Main directional light (from top-front-right) for soft shadows
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.5);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -10;
    mainLight.shadow.camera.right = 10;
    mainLight.shadow.camera.top = 10;
    mainLight.shadow.camera.bottom = -10;
    mainLight.shadow.bias = -0.0001;
    scene.add(mainLight);
    
    // Fill light (from opposite side) to soften shadows
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);
    
    // Hemisphere light for subtle ambient variation (sky/ground)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    // Create XYZ corner grid system (like a 3D graph)
    const gridSize = 5; // 5 meters in each direction
    const gridDivisions = 10; // 50cm divisions
    const gridColor = 0x333333;
    const gridColorSecondary = 0x222222;
    
    // Floor grid (XZ plane) - positioned at corner, not centered
    const floorGrid = new THREE.GridHelper(gridSize * 2, gridDivisions * 2, gridColor, gridColorSecondary);
    floorGrid.position.set(gridSize, 0, gridSize); // Shift so corner is at origin
    scene.add(floorGrid);
    
    // Create wireframe walls for left (YZ plane at X=0) and back (XY plane at Z=0)
    const wallMaterial = new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.5 });
    
    // Left wall grid (YZ plane at X=0)
    const leftWallPoints = [];
    const wallHeight = 2.5; // 2.5 meters tall
    const wallHeightDivisions = 5; // 50cm divisions
    
    // Vertical lines on left wall
    for (let z = 0; z <= gridSize * 2; z += gridSize * 2 / gridDivisions) {
      leftWallPoints.push(new THREE.Vector3(0, 0, z));
      leftWallPoints.push(new THREE.Vector3(0, wallHeight, z));
    }
    // Horizontal lines on left wall
    for (let y = 0; y <= wallHeight; y += wallHeight / wallHeightDivisions) {
      leftWallPoints.push(new THREE.Vector3(0, y, 0));
      leftWallPoints.push(new THREE.Vector3(0, y, gridSize * 2));
    }
    
    const leftWallGeometry = new THREE.BufferGeometry().setFromPoints(leftWallPoints);
    const leftWall = new THREE.LineSegments(leftWallGeometry, wallMaterial);
    scene.add(leftWall);
    
    // Back wall grid (XY plane at Z=0)
    const backWallPoints = [];
    
    // Vertical lines on back wall
    for (let x = 0; x <= gridSize * 2; x += gridSize * 2 / gridDivisions) {
      backWallPoints.push(new THREE.Vector3(x, 0, 0));
      backWallPoints.push(new THREE.Vector3(x, wallHeight, 0));
    }
    // Horizontal lines on back wall
    for (let y = 0; y <= wallHeight; y += wallHeight / wallHeightDivisions) {
      backWallPoints.push(new THREE.Vector3(0, y, 0));
      backWallPoints.push(new THREE.Vector3(gridSize * 2, y, 0));
    }
    
    const backWallGeometry = new THREE.BufferGeometry().setFromPoints(backWallPoints);
    const backWall = new THREE.LineSegments(backWallGeometry, wallMaterial);
    scene.add(backWall);
    
    // Add axis lines at corner (thicker/colored)
    const axisLength = 0.5;
    const axisMaterialX = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 }); // Red for X
    const axisMaterialY = new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2 }); // Green for Y
    const axisMaterialZ = new THREE.LineBasicMaterial({ color: 0x4444ff, linewidth: 2 }); // Blue for Z
    
    const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(axisLength, 0, 0)
    ]);
    const yAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, axisLength, 0)
    ]);
    const zAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, axisLength)
    ]);
    
    scene.add(new THREE.Line(xAxisGeo, axisMaterialX));
    scene.add(new THREE.Line(yAxisGeo, axisMaterialY));
    scene.add(new THREE.Line(zAxisGeo, axisMaterialZ));

    // Snap indicators (visual feedback for snap points)
    const snapIndicatorMeshes = [];
    const snapLineMaterial = new THREE.LineBasicMaterial({ 
      color: 0x4a9962, 
      linewidth: 2, 
      transparent: true, 
      opacity: 0.9,
      depthTest: false  // Render on top of everything
    });
    
    // Materials for different snap types
    const snapMaterials = {
      element: new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false }), // Green - same height
      grid: new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false }),    // Blue - grid snap
      warning: new THREE.LineBasicMaterial({ color: 0xff4444, depthTest: false })  // Red - different heights
    };
    
    window.updateSnapIndicators = (indicators) => {
      // Remove old indicators
      snapIndicatorMeshes.forEach(mesh => scene.remove(mesh));
      snapIndicatorMeshes.length = 0;
      
      // Add new indicators
      indicators.forEach(ind => {
        const y = ind.y ?? 0.01; // Use provided height or default
        const snapType = ind.type || 'element'; // 'element', 'grid', or 'warning'
        const material = snapMaterials[snapType] || snapMaterials.element;
        
        // Create a line at snap point at correct height
        const points = [];
        if (ind.axis === 'x') {
          points.push(new THREE.Vector3(ind.x, y, ind.z - 2));
          points.push(new THREE.Vector3(ind.x, y, ind.z + 2));
        } else {
          points.push(new THREE.Vector3(ind.x - 2, y, ind.z));
          points.push(new THREE.Vector3(ind.x + 2, y, ind.z));
        }
        
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 999; // Render last
        scene.add(line);
        snapIndicatorMeshes.push(line);
        
        // Add a small sphere at intersection with matching color
        const sphereGeo = new THREE.SphereGeometry(0.03, 8, 8);
        const sphereColor = snapType === 'warning' ? 0xff4444 : (snapType === 'grid' ? 0x4488ff : 0x4a9962);
        const sphereMat = new THREE.MeshBasicMaterial({ 
          color: sphereColor,
          depthTest: false  // Render on top
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.set(ind.x, y + 0.01, ind.z);
        sphere.renderOrder = 999; // Render last
        scene.add(sphere);
        snapIndicatorMeshes.push(sphere);
      });
    };
    
    window.clearSnapIndicators = () => {
      snapIndicatorMeshes.forEach(mesh => scene.remove(mesh));
      snapIndicatorMeshes.length = 0;
    };

    // Raycaster for picking
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Initialize target if not exists
    if (!orbitRef.current.target) {
      orbitRef.current.target = { x: 0, y: 0, z: 0 };
    }

    // Update camera position
    const updateCamera = () => {
      const { theta, phi, radius, target } = orbitRef.current;
      const tx = target?.x || 0;
      const ty = target?.y || 0;
      const tz = target?.z || 0;
      
      camera.position.x = tx + radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = ty + radius * Math.cos(phi);
      camera.position.z = tz + radius * Math.sin(phi) * Math.sin(theta);
      camera.lookAt(tx, ty, tz);
    };
    updateCamera();

    // Mouse state
    let isDraggingOrbit = false;
    let isDraggingPan = false;
    let isDraggingElement = false;
    let isRotatingElement = false;
    let isMarqueeSelecting = false;
    let marqueeStart = null;
    let prevMouse = { x: 0, y: 0 };
    let dragStartPos = null;
    let draggedElementId = null;

    const getMousePosition = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const getIntersectedElement = (e) => {
      getMousePosition(e);
      raycaster.setFromCamera(mouse, camera);
      const meshArray = Object.entries(meshesRef.current).map(([id, mesh]) => {
        mesh.userData.elementId = id;
        return mesh;
      });
      const intersects = raycaster.intersectObjects(meshArray, true);
      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.elementId) {
          obj = obj.parent;
        }
        return obj?.userData.elementId || null;
      }
      return null;
    };

    const getPlaneIntersection = (e) => {
      getMousePosition(e);
      raycaster.setFromCamera(mouse, camera);
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersectPoint);
      return intersectPoint;
    };

    const handleMouseDown = (e) => {
      prevMouse = { x: e.clientX, y: e.clientY };
      
      // Middle mouse button (button 1) - orbit, or pan with Shift
      if (e.button === 1) {
        e.preventDefault();
        if (e.shiftKey) {
          isDraggingPan = true;
        } else {
          isDraggingOrbit = true;
        }
        return;
      }
      
      // Right mouse button (button 2) - pan
      if (e.button === 2) {
        e.preventDefault();
        isDraggingPan = true;
        return;
      }
      
      // Left click - element interaction
      if (e.button === 0) {
        // Alt + left click = orbit (touchpad friendly alternative)
        if (e.altKey) {
          e.preventDefault();
          isDraggingOrbit = true;
          return;
        }
        
        const hitElementId = getIntersectedElement(e);
        
        if (hitElementId) {
          // Shift+Click for duplicate on drag start
          if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
            // Will duplicate on first move
            window._pendingDuplicate = true;
          }
          
          // Clicked on an element - pass ctrlKey for multi-select (not shiftKey which is for duplicate)
          window.selectElement?.(hitElementId, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: false });
          
          const currentTool = window.getCurrentTool?.() || 'select';
          
          if (currentTool === 'move') {
            isDraggingElement = true;
            draggedElementId = hitElementId;
            dragStartPos = getPlaneIntersection(e);
          } else if (currentTool === 'rotate') {
            isRotatingElement = true;
            draggedElementId = hitElementId;
          }
        } else {
          // Clicked on empty space - start marquee selection or deselect
          const currentTool = window.getCurrentTool?.() || 'select';
          if (currentTool === 'select' || currentTool === 'move') {
            // Start marquee selection
            const rect = canvas.getBoundingClientRect();
            marqueeStart = { 
              x: e.clientX - rect.left, 
              y: e.clientY - rect.top,
              clientX: e.clientX,
              clientY: e.clientY
            };
            isMarqueeSelecting = true;
            
            // Deselect if not holding Ctrl
            if (!e.ctrlKey && !e.metaKey) {
              window.deselectAll?.();
            }
          }
        }
      }
    };

    const handleMouseUp = (e) => {
      // Commit any pending position/rotation changes to React state
      if (isDraggingElement || isRotatingElement) {
        window.commitElementChanges?.();
      }
      
      // Finish marquee selection
      if (isMarqueeSelecting && marqueeStart) {
        const rect = canvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        // Calculate marquee bounds in screen space
        const minX = Math.min(marqueeStart.x, endX);
        const maxX = Math.max(marqueeStart.x, endX);
        const minY = Math.min(marqueeStart.y, endY);
        const maxY = Math.max(marqueeStart.y, endY);
        
        // Only select if marquee is bigger than 5px (to avoid accidental clicks)
        if (maxX - minX > 5 || maxY - minY > 5) {
          // Find elements within marquee
          const selectedByMarquee = [];
          
          Object.entries(meshesRef.current).forEach(([id, mesh]) => {
            // Get mesh center in screen coordinates
            const worldPos = new THREE.Vector3();
            mesh.getWorldPosition(worldPos);
            
            // Project to screen
            const screenPos = worldPos.clone().project(camera);
            const screenX = (screenPos.x + 1) / 2 * rect.width;
            const screenY = (-screenPos.y + 1) / 2 * rect.height;
            
            // Check if within marquee
            if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
              selectedByMarquee.push(id);
            }
          });
          
          if (selectedByMarquee.length > 0) {
            window.selectByMarquee?.(selectedByMarquee, e.ctrlKey || e.metaKey);
          }
        }
        
        // Hide marquee rectangle
        window.updateMarquee?.(null);
      }
      
      // Clear snap indicators
      window.clearSnapIndicators?.();
      // Clear duplicate flag
      window._pendingDuplicate = false;
      // Clear multi-rotate pivot cache
      window._multiRotatePivot = null;
      window._multiRotateOffsets = null;
      window._multiRotateBaseRot = null;
      window._multiRotateAccum = 0;
      
      isDraggingOrbit = false;
      isDraggingPan = false;
      isDraggingElement = false;
      isRotatingElement = false;
      isMarqueeSelecting = false;
      marqueeStart = null;
      draggedElementId = null;
      dragStartPos = null;
    };

    const handleMouseMove = (e) => {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      
      // Update marquee rectangle if selecting
      if (isMarqueeSelecting && marqueeStart) {
        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        window.updateMarquee?.({
          left: Math.min(marqueeStart.x, currentX),
          top: Math.min(marqueeStart.y, currentY),
          width: Math.abs(currentX - marqueeStart.x),
          height: Math.abs(currentY - marqueeStart.y)
        });
        return;
      }
      
      if (isDraggingOrbit) {
        orbitRef.current.theta += dx * 0.005;  // Reversed direction, slower
        orbitRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbitRef.current.phi - dy * 0.005));  // Reversed Y
        prevMouse = { x: e.clientX, y: e.clientY };
        updateCamera();
        tutorialMarkAction('orbited-camera');
      } else if (isDraggingPan) {
        // Pan camera target based on camera's right and forward vectors
        const panSpeed = 0.002 * orbitRef.current.radius;
        const theta = orbitRef.current.theta;
        
        // Camera right vector (perpendicular to view direction on XZ plane)
        const rightX = Math.sin(theta);
        const rightZ = -Math.cos(theta);
        
        // Camera forward vector projected on XZ plane (for vertical mouse = depth)
        const forwardX = Math.cos(theta);
        const forwardZ = Math.sin(theta);
        
        if (!orbitRef.current.target) {
          orbitRef.current.target = { x: 0, y: 0, z: 0 };
        }
        
        // Mouse left/right moves along camera right vector
        // Mouse up/down moves along camera forward vector
        orbitRef.current.target.x -= (dx * rightX + dy * forwardX) * panSpeed;
        orbitRef.current.target.z -= (dx * rightZ + dy * forwardZ) * panSpeed;
        
        prevMouse = { x: e.clientX, y: e.clientY };
        updateCamera();
        tutorialMarkAction('panned-camera');
      } else if (isDraggingElement && draggedElementId && dragStartPos) {
        const currentPos = getPlaneIntersection(e);
        const delta = {
          x: currentPos.x - dragStartPos.x,
          z: currentPos.z - dragStartPos.z,
        };
        
        window.moveElement?.(draggedElementId, delta);
        dragStartPos = currentPos;
      } else if (isRotatingElement && draggedElementId) {
        const dx = e.clientX - prevMouse.x;
        window.rotateElement?.(draggedElementId, dx);
        prevMouse = { x: e.clientX, y: e.clientY };
      }
    };

    const handleWheel = (e) => {
      e.preventDefault();
      
      // Zoom proportional cu distanța — pași mici zoomed in, pași mari zoomed out
      const zoomFactor = orbitRef.current.radius * 0.08;
      
      // Detect if this is likely a touchpad (has both deltaX and deltaY, or ctrlKey for pinch)
      const isTouchpad = Math.abs(e.deltaX) > 0 || e.ctrlKey;
      
      if (e.ctrlKey) {
        // Pinch to zoom on touchpad (ctrlKey is set during pinch gesture)
        const delta = e.deltaY > 0 ? 1 : -1;
        orbitRef.current.radius = Math.max(1, Math.min(25, orbitRef.current.radius + delta * zoomFactor * 0.3));
        updateCamera();
        tutorialMarkAction('zoomed-camera');
      } else if (isTouchpad && Math.abs(e.deltaX) > 0) {
        // Two-finger pan on touchpad
        const panSpeed = 0.005 * orbitRef.current.radius;
        const theta = orbitRef.current.theta;
        
        const rightX = Math.sin(theta);
        const rightZ = -Math.cos(theta);
        const forwardX = Math.cos(theta);
        const forwardZ = Math.sin(theta);
        
        if (!orbitRef.current.target) {
          orbitRef.current.target = { x: 0, y: 0, z: 0 };
        }
        
        orbitRef.current.target.x -= (e.deltaX * rightX + e.deltaY * forwardX) * panSpeed;
        orbitRef.current.target.z -= (e.deltaX * rightZ + e.deltaY * forwardZ) * panSpeed;
        updateCamera();
      } else {
        // Regular mouse wheel - zoom proportional
        const delta = e.deltaY > 0 ? 1 : -1;
        orbitRef.current.radius = Math.max(1, Math.min(25, orbitRef.current.radius + delta * zoomFactor));
        updateCamera();
        tutorialMarkAction('zoomed-camera');
      }
    };
    
    // Prevent context menu on right click
    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    // Double click to select
    const handleDblClick = (e) => {
      const hitElementId = getIntersectedElement(e);
      if (hitElementId) {
        window.selectElement?.(hitElementId, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      }
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dblclick', handleDblClick);
    canvas.addEventListener('contextmenu', handleContextMenu);

    // Resize handler
    const handleResize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        camera.aspect = parent.clientWidth / parent.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(parent.clientWidth, parent.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDblClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // Gizmo ref
  const gizmoRef = useRef(null);

  // Update gizmo based on tool and selection
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Remove existing gizmo
    if (gizmoRef.current) {
      sceneRef.current.remove(gizmoRef.current);
      gizmoRef.current = null;
    }
    
    // Don't show gizmo if nothing selected
    if (selectedIds.length === 0) return;
    
    // Calculate center of selection
    const selectedEls = elements.filter(e => selectedIds.includes(e.id));
    if (selectedEls.length === 0) return;
    
    const centerX = selectedEls.reduce((sum, e) => sum + getWorldPosition(e).x, 0) / selectedEls.length;
    const centerZ = selectedEls.reduce((sum, e) => sum + getWorldPosition(e).z, 0) / selectedEls.length;
    
    // Get average Y position (top of elements)
    const avgY = selectedEls.reduce((sum, e) => {
      const placementHeight = (e.placementHeight || 90) / 100;
      const thickness = (e.thickness || 12) / 1000;
      return sum + placementHeight + thickness;
    }, 0) / selectedEls.length;
    
    const gizmoGroup = new THREE.Group();
    gizmoGroup.position.set(centerX, avgY, centerZ);
    
    if (tool === 'move') {
      // Create move gizmo (3 arrows for X, Y, Z axes)
      const arrowLength = 0.25;
      const arrowHeadLength = 0.06;
      const arrowHeadWidth = 0.03;
      
      // X axis (red)
      const xDir = new THREE.Vector3(1, 0, 0);
      const xArrow = new THREE.ArrowHelper(xDir, new THREE.Vector3(0, 0, 0), arrowLength, 0xff4444, arrowHeadLength, arrowHeadWidth);
      xArrow.line.material.depthTest = false;
      xArrow.cone.material.depthTest = false;
      xArrow.renderOrder = 999;
      gizmoGroup.add(xArrow);
      
      // Y axis (green)
      const yDir = new THREE.Vector3(0, 1, 0);
      const yArrow = new THREE.ArrowHelper(yDir, new THREE.Vector3(0, 0, 0), arrowLength, 0x44ff44, arrowHeadLength, arrowHeadWidth);
      yArrow.line.material.depthTest = false;
      yArrow.cone.material.depthTest = false;
      yArrow.renderOrder = 999;
      gizmoGroup.add(yArrow);
      
      // Z axis (blue)
      const zDir = new THREE.Vector3(0, 0, 1);
      const zArrow = new THREE.ArrowHelper(zDir, new THREE.Vector3(0, 0, 0), arrowLength, 0x4444ff, arrowHeadLength, arrowHeadWidth);
      zArrow.line.material.depthTest = false;
      zArrow.cone.material.depthTest = false;
      zArrow.renderOrder = 999;
      gizmoGroup.add(zArrow);
      
    } else if (tool === 'rotate') {
      // Create rotate gizmo (3 circles/tori for X, Y, Z rotation)
      const torusRadius = 0.18;
      const tubeRadius = 0.006;
      const segments = 32;
      
      // Y rotation (green ring - horizontal)
      const yTorusGeo = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, segments);
      const yTorusMat = new THREE.MeshBasicMaterial({ color: 0x44ff44, depthTest: false, transparent: true, opacity: 0.8 });
      const yTorus = new THREE.Mesh(yTorusGeo, yTorusMat);
      yTorus.rotation.x = Math.PI / 2; // Horizontal
      yTorus.renderOrder = 999;
      gizmoGroup.add(yTorus);
      
      // X rotation (red ring - vertical along X)
      const xTorusGeo = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, segments);
      const xTorusMat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.8 });
      const xTorus = new THREE.Mesh(xTorusGeo, xTorusMat);
      xTorus.rotation.y = Math.PI / 2; // Vertical along X
      xTorus.renderOrder = 999;
      gizmoGroup.add(xTorus);
      
      // Z rotation (blue ring - vertical along Z)
      const zTorusGeo = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, segments);
      const zTorusMat = new THREE.MeshBasicMaterial({ color: 0x4444ff, depthTest: false, transparent: true, opacity: 0.8 });
      const zTorus = new THREE.Mesh(zTorusGeo, zTorusMat);
      // Default orientation is vertical along Z
      zTorus.renderOrder = 999;
      gizmoGroup.add(zTorus);
    }
    
    if (gizmoGroup.children.length > 0) {
      sceneRef.current.add(gizmoGroup);
      gizmoRef.current = gizmoGroup;
      
      // Expose function to update gizmo position during drag
      window.updateGizmoPosition = (x, y, z) => {
        if (gizmoRef.current) {
          gizmoRef.current.position.set(x, y, z);
        }
      };
    }
    
    return () => {
      if (gizmoRef.current && sceneRef.current) {
        sceneRef.current.remove(gizmoRef.current);
        gizmoRef.current = null;
      }
      delete window.updateGizmoPosition;
    };
  }, [tool, selectedIds, elements, groups]);

  // Use the shared computeLayout function for texture UV mapping
  const layoutData = useMemo(() => {
    if (!library || !library.colors || library.colors.length === 0) {
      return { pieces: [], tiles: [], piecesByKey: {} };
    }
    return computeLayout(elements, library, manualLayoutPositions);
  }, [elements, library, manualLayoutPositions]);
  
  // pieceLayout for 3D UV mapping - computeLayout already includes fixed positions
  const pieceLayout = layoutData.piecesByKey;

  // Track previous element properties to detect what changed
  const prevElementsRef = useRef({});
  const prevLayoutRef = useRef({}); // Track previous layout for UV changes
  const prevForceRenderKeyRef = useRef(0); // Track force render key
  
  // Helper to get layout hash for an element (for detecting UV changes)
  const getLayoutHash = (elId) => {
    const keys = Object.keys(pieceLayout).filter(k => k.startsWith(elId));
    const layoutData = {};
    keys.forEach(k => {
      const p = pieceLayout[k];
      if (p) {
        layoutData[k] = { x: p.x, y: p.y, tileIndex: p.tileIndex };
      }
    });
    return JSON.stringify(layoutData);
  };
  
  // Helper to get geometry-affecting properties (excluding position/rotation)
  const getGeometryHash = (el) => {
    return JSON.stringify({
      type: el.type,
      length: el.length,
      width: el.width,  // For cabinet
      depth: el.depth,
      height: el.height,
      thickness: el.thickness,
      material: el.material,
      color: el.color,  // For cabinet
      doors: el.doors,  // For cabinet division lines
      drawers: el.drawers,  // For cabinet division lines
      placementHeight: el.placementHeight,
      waterfallLeft: el.waterfallLeft,
      waterfallRight: el.waterfallRight,
      waterfallHeight: el.waterfallHeight,
      grainLengthwise: el.grainLengthwise,
      cutouts: el.cutouts, // Include cutouts in hash for change detection
      inductionSystems: el.inductionSystems, // Include induction in hash
    });
  };

  // Update 3D meshes when elements change
  useEffect(() => {
    if (!sceneRef.current) return;

    // Check if force render was triggered - reset prev refs to force full rebuild
    if (forceRenderKey !== prevForceRenderKeyRef.current) {
      prevElementsRef.current = {};
      prevLayoutRef.current = {};
      prevForceRenderKeyRef.current = forceRenderKey;
    }

    // Clean up scene-level debug tile helpers from previous render
    const sceneHelpersToRemove = [];
    sceneRef.current.traverse((child) => {
      if (child.userData?.isDebugTileHelper) {
        sceneHelpersToRemove.push(child);
      }
    });
    sceneHelpersToRemove.forEach((helper) => {
      sceneRef.current.remove(helper);
      if (helper.geometry) helper.geometry.dispose();
      if (helper.material) {
        if (helper.material.map) helper.material.map.dispose();
        helper.material.dispose();
      }
    });

    const currentIds = new Set(elements.map(el => el.id));
    const prevIds = new Set(Object.keys(prevElementsRef.current));
    
    // Find elements to remove
    prevIds.forEach(id => {
      if (!currentIds.has(id) && meshesRef.current[id]) {
        sceneRef.current.remove(meshesRef.current[id]);
        meshesRef.current[id].geometry.dispose();
        if (meshesRef.current[id].material.map) {
          meshesRef.current[id].material.map.dispose();
        }
        meshesRef.current[id].material.dispose();
        delete meshesRef.current[id];
      }
    });

    // Recalculate layout for new/changed elements
    const layout = pieceLayout;

    elements.forEach(el => {
      const prevEl = prevElementsRef.current[el.id];
      const prevHash = prevEl ? getGeometryHash(prevEl) : null;
      const currentHash = getGeometryHash(el);
      const geometryChanged = prevHash !== currentHash;
      const isNew = !prevEl;
      
      // Check if this element is selected OR if any element in same group is selected
      const isDirectlySelected = selectedIds.includes(el.id);
      const isGroupSelected = el.groupId && elements.some(e => e.groupId === el.groupId && selectedIds.includes(e.id));
      const shouldHighlight = isDirectlySelected || isGroupSelected;
      
      const wasSelected = prevEl?._wasSelected || false;
      const selectionChanged = prevEl && (shouldHighlight !== wasSelected);
      
      // Check if groupId changed (affects highlight color)
      const groupIdChanged = prevEl && (prevEl.groupId !== el.groupId);
      
      // Check if debugTexture mode changed (affects material shader)
      const debugModeChanged = prevDebugTextureRef.current !== debugTexture;
      
      // Check if selected cutout changed (affects cutout highlight)
      const cutoutSelectionChanged = prevSelectedCutoutIdRef.current !== selectedCutoutId;
      const inductionSelectionChanged = prevSelectedInductionIdRef.current !== selectedInductionId;
      
      // Check if layout changed (affects UV mapping)
      const currentLayoutHash = getLayoutHash(el.id);
      const prevLayoutHash = prevLayoutRef.current[el.id];
      const layoutChanged = prevLayoutHash !== undefined && prevLayoutHash !== currentLayoutHash;
      
      // If only position/rotation changed, just update the mesh transform
      // But skip if we're dragging - the drag handlers update positions directly
      if (!isNew && !geometryChanged && !selectionChanged && !groupIdChanged && !debugModeChanged && !layoutChanged && !cutoutSelectionChanged && !inductionSelectionChanged && meshesRef.current[el.id]) {
        if (!isDraggingRef.current) {
          const mesh = meshesRef.current[el.id];
          const worldPos = getWorldPosition(el);
          const worldRot = getWorldRotation(el);
          mesh.position.x = worldPos.x;
          mesh.position.z = worldPos.z;
          mesh.rotation.y = worldRot * Math.PI / 180;
        }
        return;
      }
      
      // For elements with waterfall, always recreate when selection changes
      // (so the colored highlights work correctly)
      const hasWaterfall = el.waterfallLeft || el.waterfallRight;
      
      // If debug mode changed, force full mesh recreation to update shader
      // If only selection or groupId or cutout selection changed and NO waterfall, update outline without recreating
      if (!isNew && !geometryChanged && !debugModeChanged && (selectionChanged || groupIdChanged || cutoutSelectionChanged || inductionSelectionChanged) && !hasWaterfall && meshesRef.current[el.id]) {
        const mesh = meshesRef.current[el.id];
        
        // Remove existing outlines AND debug tile helpers AND induction meshes from mesh
        const toRemove = [];
        mesh.traverse((child) => {
          if (child.isLineSegments || child.userData?.isDebugTileHelper || child.userData?.isCutoutHighlight || child.userData?.isInductionMesh) {
            toRemove.push({ parent: child.parent, child: child });
          }
        });
        toRemove.forEach(({ parent, child }) => {
          if (parent) {
            parent.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        });
        
        // When debug mode is active, update material transparency based on selection
        if (debugTexture) {
          const colorData = library.colors.find(c => c.id === el.material) || { color: '#666666' };
          const color = new THREE.Color(colorData.color);
          const layoutInfo = layout[`${el.id}_main`];
          const isBacksplash = el.type === 'backsplash';
          
          if (shouldHighlight) {
            // Selected: make transparent
            const transparentMat = new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: 0,
              depthWrite: false
            });
            mesh.material.dispose();
            mesh.material = transparentMat;
          } else {
            // Deselected: restore texture
            if (colorData.texture && layoutInfo) {
              loadTextureWithCache(colorData.texture, (texture) => {
                const triplanarMat = createTriplanarMaterial(texture, layoutInfo, isBacksplash, color, false);
                mesh.material.dispose();
                mesh.material = triplanarMat;
              }, rendererRef);
            } else {
              mesh.material.dispose();
              mesh.material = new THREE.MeshLambertMaterial({ color: color });
            }
          }
        }
        
        // Add outline if selected (MeshBasicMaterial doesn't have emissive, so just outline)
        if (shouldHighlight) {
          // Use group color for grouped elements, gold for ungrouped
          const groupColorData = getGroupColor(el.groupId);
          const outlineColor = groupColorData ? groupColorData.hex : 0xc9a962;
          mesh.traverse((child) => {
            if (child.isMesh && child.geometry && !child.userData?.isDebugTileHelper) {
              const edges = new THREE.EdgesGeometry(child.geometry, 15);
              const lineMaterial = new THREE.LineBasicMaterial({ 
                color: outlineColor, 
                linewidth: 2,
                depthTest: false,
                transparent: true,
                opacity: 1
              });
              const outline = new THREE.LineSegments(edges, lineMaterial);
              outline.renderOrder = 998;
              outline.raycast = () => {}; // Disable raycast on outline
              child.add(outline);
            }
          });
        } else if (el.type === 'cabinet') {
          // Cabinet not selected: always show black edges (not x-ray)
          mesh.traverse((child) => {
            if (child.isMesh && child.geometry && !child.userData?.isDebugTileHelper) {
              const edges = new THREE.EdgesGeometry(child.geometry, 15);
              const lineMaterial = new THREE.LineBasicMaterial({ 
                color: 0x303030, 
                linewidth: 2,
                depthTest: true,  // Not x-ray - respects depth
                transparent: false
              });
              const outline = new THREE.LineSegments(edges, lineMaterial);
              outline.raycast = () => {};
              child.add(outline);
            }
          });
        }
        
        // Add debug tile helper if debug mode is active (only for selected non-cabinet elements)
        if (shouldHighlight && el.type !== 'cabinet') {
          const isDebugActive = debugTexture && shouldHighlight;
          const layoutInfo = layout[`${el.id}_main`];
          const colorData = library.colors.find(c => c.id === el.material) || { color: '#666666' };
          
          if (isDebugActive && layoutInfo && colorData.texture) {
            const isBacksplash = el.type === 'backsplash';
            const color = new THREE.Color(colorData.color);
            createTileHelper(mesh, layoutInfo, colorData, isBacksplash, color, { rendererRef, sceneRef, cameraRef });
          }
        }
          
        // Add cutout highlight if a cutout is selected
        if (selectedCutoutId && el.cutouts) {
            const selectedCutout = el.cutouts.find(c => c.id === selectedCutoutId);
            if (selectedCutout) {
              const isBacksplash = el.type === 'backsplash';
              const pos = getCutout3DPosition(selectedCutout, el.thickness || 12, isBacksplash);
              const dims = getCutoutDimensions(selectedCutout);
              
              let fillShape, outlineShape;
              if (dims.type === 'circle') {
                fillShape = new THREE.CircleGeometry(dims.radius, 32);
                outlineShape = new THREE.RingGeometry(dims.radius - 0.003, dims.radius + 0.003, 32);
              } else {
                fillShape = new THREE.PlaneGeometry(dims.width, dims.height);
                const hw = dims.width / 2, hh = dims.height / 2;
                const points = [
                  new THREE.Vector3(-hw, -hh, 0), new THREE.Vector3(hw, -hh, 0),
                  new THREE.Vector3(hw, hh, 0), new THREE.Vector3(-hw, hh, 0),
                  new THREE.Vector3(-hw, -hh, 0)
                ];
                outlineShape = new THREE.BufferGeometry().setFromPoints(points);
              }
              
              const fillMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00c8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false
              });
              const fillMesh = new THREE.Mesh(fillShape, fillMaterial);
              fillMesh.renderOrder = 998;
              fillMesh.raycast = () => {};
              fillMesh.userData.isCutoutHighlight = true;
              
              const outlineMaterial = dims.type === 'circle'
                ? new THREE.MeshBasicMaterial({ color: 0x00c8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
                : new THREE.LineBasicMaterial({ color: 0x00c8ff, linewidth: 2 });
              const outlineMesh = dims.type === 'circle'
                ? new THREE.Mesh(outlineShape, outlineMaterial)
                : new THREE.Line(outlineShape, outlineMaterial);
              outlineMesh.renderOrder = 999;
              outlineMesh.raycast = () => {};
              outlineMesh.userData.isCutoutHighlight = true;
              
              if (!isBacksplash) {
                fillMesh.rotation.x = -Math.PI / 2;
                outlineMesh.rotation.x = -Math.PI / 2;
              }
              fillMesh.position.set(pos.x, pos.y, pos.z);
              outlineMesh.position.set(pos.x, pos.y + 0.001, pos.z);
              
              mesh.add(fillMesh);
              mesh.add(outlineMesh);
            }
          }

        // Re-create induction system meshes (they were removed in cleanup)
        if (el.type === 'island' && el.inductionSystems && el.inductionSystems.length > 0) {
          const thicknessCmLocal = (el.thickness || 12) / 1000;
          el.inductionSystems.forEach(sys => {
            const extrudeM = (sys.depth || 50) / 1000;
            const isIndSelected = selectedInductionId === sys.id;
            let indGeo;
            if (sys.type === 'circle') {
              const radiusM = (sys.radius || 5) / 100;
              indGeo = new THREE.CylinderGeometry(radiusM, radiusM, extrudeM, 32);
            } else {
              const wM = (sys.width || 56) / 100;
              const hM = (sys.height || 49) / 100;
              indGeo = new THREE.BoxGeometry(wM, extrudeM, hM);
            }
            const inductionMat = new THREE.MeshBasicMaterial({ 
              color: isIndSelected ? 0xc97a32 : 0x222222,
              transparent: true, opacity: isIndSelected ? 0.5 : 0.3,
              depthTest: false, side: THREE.DoubleSide,
            });
            const indMesh = new THREE.Mesh(indGeo, inductionMat);
            indMesh.renderOrder = 500;
            indMesh.userData.isInductionMesh = true;
            indMesh.position.set((sys.centerX || 0) / 100, -thicknessCmLocal / 2 - extrudeM / 2, (sys.centerZ || 0) / 100);
            indMesh.raycast = () => {};
            const edges = new THREE.EdgesGeometry(indGeo, 15);
            const edgeMat = new THREE.LineBasicMaterial({ 
              color: isIndSelected ? 0xc97a32 : 0x555555,
              depthTest: false, transparent: true, opacity: isIndSelected ? 1 : 0.6,
            });
            const edgeLines = new THREE.LineSegments(edges, edgeMat);
            edgeLines.renderOrder = 501;
            edgeLines.raycast = () => {};
            edgeLines.userData.isInductionMesh = true;
            indMesh.add(edgeLines);
            if (isIndSelected) {
              const glowEdges = new THREE.EdgesGeometry(indGeo, 15);
              const glowMat = new THREE.LineBasicMaterial({ color: 0xc97a32, depthTest: false, transparent: true, opacity: 0.4 });
              const glowLines = new THREE.LineSegments(glowEdges, glowMat);
              glowLines.renderOrder = 502;
              glowLines.raycast = () => {};
              glowLines.userData.isInductionMesh = true;
              indMesh.add(glowLines);
            }
            mesh.add(indMesh);
          });
        }
        
        // Update position/rotation too
        const worldPos = getWorldPosition(el);
        const worldRot = getWorldRotation(el);
        mesh.position.x = worldPos.x;
        mesh.position.z = worldPos.z;
        mesh.rotation.y = worldRot * Math.PI / 180;
        return;
      }
      
      // Need to recreate mesh - remove old one first
      if (meshesRef.current[el.id]) {
        sceneRef.current.remove(meshesRef.current[el.id]);
        meshesRef.current[el.id].traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        });
        delete meshesRef.current[el.id];
      }

      // Handle cabinet (furniture) separately - simple box with solid color
      if (el.type === 'cabinet') {
        const cabinetWidth = (el.width || 60) / 100;
        const cabinetDepth = (el.depth || 60) / 100;
        const cabinetHeight = (el.height || 85) / 100;
        const placementHeight = (el.placementHeight ?? 0) / 100;
        
        const geometry = new THREE.BoxGeometry(cabinetWidth, cabinetHeight, cabinetDepth);
        const color = new THREE.Color(el.color || '#4a4a4a');
        const material = new THREE.MeshLambertMaterial({ color: color });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Add gradient front face overlay
        const frontGeometry = new THREE.PlaneGeometry(cabinetWidth, cabinetHeight);
        
        // Create vertex colors for gradient (bottom darker, top lighter)
        const frontColors = new Float32Array([
          // Bottom-left (slightly darker)
          color.r * 0.95, color.g * 0.95, color.b * 0.95,
          // Bottom-right (slightly darker)
          color.r * 0.95, color.g * 0.95, color.b * 0.95,
          // Top-left (slightly lighter)
          color.r * 1.05, color.g * 1.05, color.b * 1.05,
          // Top-right (slightly lighter)
          color.r * 1.05, color.g * 1.05, color.b * 1.05,
        ]);
        frontGeometry.setAttribute('color', new THREE.BufferAttribute(frontColors, 3));
        
        const frontMaterial = new THREE.MeshBasicMaterial({ 
          vertexColors: true,
          side: THREE.FrontSide
        });
        const frontFace = new THREE.Mesh(frontGeometry, frontMaterial);
        frontFace.position.z = cabinetDepth / 2 + 0.0005; // Slightly in front
        frontFace.raycast = () => {}; // Don't interfere with selection
        mesh.add(frontFace);
        
        // Position
        const worldPos = getWorldPosition(el);
        const worldRot = getWorldRotation(el);
        mesh.position.set(worldPos.x, placementHeight + cabinetHeight / 2, worldPos.z);
        mesh.rotation.y = (worldRot * Math.PI) / 180;
        
        // Add edges - different style based on selection
        const edges = new THREE.EdgesGeometry(geometry, 15);
        const groupColorData = getGroupColor(el.groupId);
        
        if (shouldHighlight) {
          // Selected: gold/group color, x-ray
          const outlineColor = groupColorData ? groupColorData.hex : 0xc9a962;
          const lineMaterial = new THREE.LineBasicMaterial({ 
            color: outlineColor, 
            linewidth: 2,
            depthTest: false,  // X-ray when selected
            transparent: true,
            opacity: 1
          });
          const outline = new THREE.LineSegments(edges, lineMaterial);
          outline.renderOrder = 998;
          outline.raycast = () => {};
          mesh.add(outline);
        } else {
          // Not selected: black, not x-ray
          const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x303030, 
            linewidth: 2,
            depthTest: true,  // Not x-ray
            transparent: false
          });
          const outline = new THREE.LineSegments(edges, lineMaterial);
          outline.raycast = () => {};
          mesh.add(outline);
        }
        
        mesh.userData = { elementId: el.id, type: 'cabinet' };
        
        // Add division lines for doors (vertical) and drawers (horizontal)
        const numDoors = el.doors || 0;
        const numDrawers = el.drawers || 0;
        
        if (numDoors > 1 || numDrawers > 1) {
          const divisionLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x303030, 
            linewidth: 1,
            depthTest: true
          });
          
          // Front face is at z = +cabinetDepth/2 (local coords) - facing the user
          const frontZ = cabinetDepth / 2 + 0.001; // Slightly in front to avoid z-fighting
          const hw = cabinetWidth / 2;
          const hh = cabinetHeight / 2;
          
          if (numDoors > 1) {
            // Vertical lines for doors
            const numLines = numDoors - 1;
            for (let i = 1; i <= numLines; i++) {
              const x = -hw + (cabinetWidth * i / numDoors);
              const points = [
                new THREE.Vector3(x, -hh, frontZ),
                new THREE.Vector3(x, hh, frontZ)
              ];
              const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
              const line = new THREE.Line(lineGeom, divisionLineMaterial);
              line.raycast = () => {};
              mesh.add(line);
            }
          }
          
          if (numDrawers > 1) {
            // Horizontal lines for drawers
            const numLines = numDrawers - 1;
            for (let i = 1; i <= numLines; i++) {
              const y = -hh + (cabinetHeight * i / numDrawers);
              const points = [
                new THREE.Vector3(-hw, y, frontZ),
                new THREE.Vector3(hw, y, frontZ)
              ];
              const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
              const line = new THREE.Line(lineGeom, divisionLineMaterial);
              line.raycast = () => {};
              mesh.add(line);
            }
          }
        }
        
        sceneRef.current.add(mesh);
        meshesRef.current[el.id] = mesh;
        
        // Store selection state for next comparison
        prevElementsRef.current[el.id] = { ...el, _wasSelected: shouldHighlight };
        prevLayoutRef.current[el.id] = getLayoutHash(el.id);
        return; // Skip the rest of the mesh creation logic
      }

      const colorData = library.colors.find(c => c.id === el.material) || { color: '#666666' };
      const color = new THREE.Color(colorData.color);

      const width = el.length / 100;
      const thicknessCm = (el.thickness || 12) / 1000;
      const placementHeight = (el.placementHeight ?? 90) / 100; // Default 90cm from floor
      
      // Get layout info for this piece
      const layoutInfo = layout[`${el.id}_main`];
      
      let geometry, posY;
      
      if (el.type === 'backsplash') {
        const panelHeight = el.height / 100;
        // Use cutout-aware geometry
        geometry = createGeometryWithCutouts(el.length, el.height, el.thickness || 12, el.cutouts, true);
        posY = placementHeight + panelHeight / 2;
      } else {
        const depth = el.depth / 100;
        // Use cutout-aware geometry
        geometry = createGeometryWithCutouts(el.length, el.depth, el.thickness || 12, el.cutouts, false);
        posY = placementHeight + thicknessCm / 2;
      }

      // Create material - use triplanar shader for proper UV mapping with cutouts
      const hasTexture = colorData.texture && layoutInfo;
      let material;
      
      if (hasTexture) {
        // Load texture using cache and create triplanar shader material
        const isBacksplash = el.type === 'backsplash';
        
        // Create placeholder material first
        material = new THREE.MeshLambertMaterial({ color: color });
      } else {
        material = new THREE.MeshLambertMaterial({ color: color });
      }
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Now load texture asynchronously and update material when ready
      if (hasTexture) {
        const isBacksplash = el.type === 'backsplash';
        loadTextureWithCache(colorData.texture, (texture) => {
          // Create triplanar material - uses local coords so no need to update position
          // Only enable debug mode for SELECTED elements
          const isDebugActive = debugTexture && shouldHighlight;
          
          if (isDebugActive) {
            // When debug mode is active, make piece fully transparent
            // Only show outline and tile helper
            const transparentMat = new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: 0,
              depthWrite: false
            });
            mesh.material.dispose();
            mesh.material = transparentMat;
          } else {
            const triplanarMat = createTriplanarMaterial(texture, layoutInfo, isBacksplash, color, false);
            mesh.material.dispose();
            mesh.material = triplanarMat;
          }
          mesh.material.needsUpdate = true;
        }, rendererRef);
      }

      // Position - use world position for grouped elements
      const worldPos = getWorldPosition(el);
      const worldRot = getWorldRotation(el);
      mesh.position.set(worldPos.x, posY, worldPos.z);
      
      // Rotation
      mesh.rotation.y = (worldRot * Math.PI) / 180;

      // Selection highlight with outline (MeshBasicMaterial doesn't have emissive)
      // Note: isDirectlySelected, isGroupSelected, shouldHighlight already declared above
      
      if (shouldHighlight) {
        // Add outline edges for selection
        const edges = new THREE.EdgesGeometry(geometry, 15);
        // Use group color for grouped elements, gold for ungrouped
        const groupColorData = getGroupColor(el.groupId);
        const outlineColor = groupColorData ? groupColorData.hex : 0xc9a962;
        const lineMaterial = new THREE.LineBasicMaterial({ 
          color: outlineColor, 
          linewidth: 2,
          depthTest: false,
          transparent: true,
          opacity: 1
        });
        const outline = new THREE.LineSegments(edges, lineMaterial);
        outline.renderOrder = 998;
        outline.raycast = () => {}; // Disable raycast on outline
        mesh.add(outline);
      }
      
      // Highlight selected cutout
      if (selectedCutoutId && el.cutouts) {
        const selectedCutout = el.cutouts.find(c => c.id === selectedCutoutId);
        if (selectedCutout) {
          const isBacksplash = el.type === 'backsplash';
          const pos = getCutout3DPosition(selectedCutout, el.thickness || 12, isBacksplash);
          const dims = getCutoutDimensions(selectedCutout);
          
          let fillShape, outlineShape;
          if (dims.type === 'circle') {
            fillShape = new THREE.CircleGeometry(dims.radius, 32);
            outlineShape = new THREE.RingGeometry(dims.radius - 0.003, dims.radius + 0.003, 32);
          } else {
            fillShape = new THREE.PlaneGeometry(dims.width, dims.height);
            const hw = dims.width / 2, hh = dims.height / 2;
            const points = [
              new THREE.Vector3(-hw, -hh, 0), new THREE.Vector3(hw, -hh, 0),
              new THREE.Vector3(hw, hh, 0), new THREE.Vector3(-hw, hh, 0),
              new THREE.Vector3(-hw, -hh, 0)
            ];
            outlineShape = new THREE.BufferGeometry().setFromPoints(points);
          }
          
          // Fill mesh
          const fillMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00c8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false
          });
          const fillMesh = new THREE.Mesh(fillShape, fillMaterial);
          fillMesh.renderOrder = 998;
          fillMesh.raycast = () => {};
          fillMesh.userData.isCutoutHighlight = true;
          
          // Outline mesh
          const outlineMaterial = dims.type === 'circle'
            ? new THREE.MeshBasicMaterial({ color: 0x00c8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
            : new THREE.LineBasicMaterial({ color: 0x00c8ff, linewidth: 2 });
          const outlineMesh = dims.type === 'circle'
            ? new THREE.Mesh(outlineShape, outlineMaterial)
            : new THREE.Line(outlineShape, outlineMaterial);
          outlineMesh.renderOrder = 999;
          outlineMesh.raycast = () => {};
          outlineMesh.userData.isCutoutHighlight = true;
          
          // Position - rotate for slab orientation
          if (!isBacksplash) {
            fillMesh.rotation.x = -Math.PI / 2;
            outlineMesh.rotation.x = -Math.PI / 2;
          }
          fillMesh.position.set(pos.x, pos.y, pos.z);
          outlineMesh.position.set(pos.x, pos.y + 0.001, pos.z);
          
          mesh.add(fillMesh);
          mesh.add(outlineMesh);
        }
      }

      // Waterfall edges (only for blat type)
      if ((el.waterfallLeft || el.waterfallRight) && el.type === 'island') {
        const waterfallHeightCm = el.waterfallHeight || el.placementHeight || 90;
        const waterfallHeightM = waterfallHeightCm / 100;
        const depthM = el.depth / 100;

        const createWaterfallMesh = (side) => {
          const wfLayout = layout[`${el.id}_${side}`];
          const wfHasTexture = colorData.texture && wfLayout;
          
          // Determine highlight color based on side
          const isSelectedElement = selectedIds.includes(el.id);
          let highlightColor = null;
          if (isSelectedElement) {
            highlightColor = side === 'left' ? 0x4a90d9 : 0x5cb85c;
          }
          
          // Create box geometry for the waterfall
          const waterfallGeo = new THREE.BoxGeometry(thicknessCm, waterfallHeightM, depthM);
          
          let mat;
          
          if (wfHasTexture) {
            // Use triplanar shader for consistent rendering with slab
            // Waterfall layout needs adjustment - it's laid out horizontally in packer
            // but rendered vertically in 3D with main face on ±X axis
            
            // Create placeholder material first
            mat = new THREE.MeshLambertMaterial({ color: color });
          } else {
            mat = new THREE.MeshLambertMaterial({ color: color });
          }
          
          const mesh = new THREE.Mesh(waterfallGeo, mat);
          mesh.raycast = () => {}; // Disable raycast - selection works via parent slab mesh
          
          // Now load texture asynchronously if needed
          if (wfLayout && colorData.texture) {
            const waterfallSide = side;
            loadTextureWithCache(colorData.texture, (texture) => {
              // Create triplanar material for waterfall (isWaterfall = true)
              // Pass side info: 'left' or 'right' to determine which face is exterior
              const isLeftWaterfall = waterfallSide === 'left';
              const triplanarMat = createTriplanarMaterial(texture, wfLayout, false, color, false, 1.0, true, isLeftWaterfall);
              mesh.material.dispose();
              mesh.material = triplanarMat;
            }, rendererRef);
          }
          
          // Add outline when selected
          if (isSelectedElement) {
            const edges = new THREE.EdgesGeometry(waterfallGeo, 15);
            const lineMat = new THREE.LineBasicMaterial({ 
              color: highlightColor,
              linewidth: 2,
              depthTest: false,
              transparent: true,
              opacity: 1
            });
            const outline = new THREE.LineSegments(edges, lineMat);
            outline.renderOrder = 998;
            outline.raycast = () => {}; // Disable raycast on outline
            mesh.add(outline);
          }
          
          return mesh;
        };

        if (el.waterfallLeft) {
          const leftWaterfall = createWaterfallMesh('left');
          leftWaterfall.position.set(-width / 2 - thicknessCm / 2, -waterfallHeightM / 2 + thicknessCm / 2, 0);
          mesh.add(leftWaterfall);
        }

        if (el.waterfallRight) {
          const rightWaterfall = createWaterfallMesh('right');
          rightWaterfall.position.set(width / 2 + thicknessCm / 2, -waterfallHeightM / 2 + thicknessCm / 2, 0);
          mesh.add(rightWaterfall);
        }
      }

      // Induction systems (extruded boxes/cylinders under the slab) - x-ray visible through slab
      if (el.type === 'island' && el.inductionSystems && el.inductionSystems.length > 0) {
        el.inductionSystems.forEach(sys => {
          const extrudeM = (sys.depth || 50) / 1000; // mm to meters
          const isSelected = selectedInductionId === sys.id;
          let indGeo;
          if (sys.type === 'circle') {
            const radiusM = (sys.radius || 5) / 100;
            indGeo = new THREE.CylinderGeometry(radiusM, radiusM, extrudeM, 32);
          } else {
            const wM = (sys.width || 56) / 100;
            const hM = (sys.height || 49) / 100;
            indGeo = new THREE.BoxGeometry(wM, extrudeM, hM);
          }
          
          // Material: visible under slab but not through waterfall
          const inductionMat = new THREE.MeshBasicMaterial({ 
            color: isSelected ? 0xc97a32 : 0x222222,
            transparent: true, 
            opacity: isSelected ? 0.5 : 0.3,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const indMesh = new THREE.Mesh(indGeo, inductionMat);
          indMesh.renderOrder = 500;
          indMesh.userData.isInductionMesh = true;
          
          // Position: centerX on length axis, centerZ on depth axis, hanging below slab
          indMesh.position.set(
            (sys.centerX || 0) / 100,
            -thicknessCm / 2 - extrudeM / 2,
            (sys.centerZ || 0) / 100
          );
          indMesh.raycast = () => {};
          
          // Edge lines (wireframe outline)
          const edges = new THREE.EdgesGeometry(indGeo, 15);
          const edgeMat = new THREE.LineBasicMaterial({ 
            color: isSelected ? 0xc97a32 : 0x555555,
            linewidth: isSelected ? 2 : 1,
            depthTest: false,
            transparent: true,
            opacity: isSelected ? 1 : 0.6,
          });
          const edgeLines = new THREE.LineSegments(edges, edgeMat);
          edgeLines.renderOrder = 501;
          edgeLines.raycast = () => {};
          indMesh.add(edgeLines);
          
          // Selection glow outline
          if (isSelected) {
            const glowEdges = new THREE.EdgesGeometry(indGeo, 15);
            const glowMat = new THREE.LineBasicMaterial({ 
              color: 0xc97a32, linewidth: 3, depthTest: false, transparent: true, opacity: 0.4
            });
            const glowLines = new THREE.LineSegments(glowEdges, glowMat);
            glowLines.renderOrder = 502;
            glowLines.raycast = () => {};
            indMesh.add(glowLines);
          }
          
          mesh.add(indMesh);
        });
      }

      sceneRef.current.add(mesh);
      meshesRef.current[el.id] = mesh;
      
      // DEBUG MODE: Create a helper mesh showing the FULL TILE at real scale
      // Only for SELECTED elements to avoid visual clutter
      const isDebugActive = debugTexture && shouldHighlight;
      if (isDebugActive && layoutInfo && colorData.texture) {
        const isBacksplashForHelper = el.type === 'backsplash';
        createTileHelper(mesh, layoutInfo, colorData, isBacksplashForHelper, color, { rendererRef, sceneRef, cameraRef });
      }
    });
    
    // Update prevElementsRef with current state including selection
    // This needs to happen for ALL elements, not just recreated ones
    const newPrevElements = {};
    elements.forEach(el => {
      // Track if element should be highlighted (directly selected or group selected)
      const isDirectlySelected = selectedIds.includes(el.id);
      const isGroupSelected = el.groupId && elements.some(e => e.groupId === el.groupId && selectedIds.includes(e.id));
      newPrevElements[el.id] = { ...el, _wasSelected: isDirectlySelected || isGroupSelected };
      
      // Update layout hash for next comparison
      prevLayoutRef.current[el.id] = getLayoutHash(el.id);
    });
    prevElementsRef.current = newPrevElements;
    
    // Update debug texture ref for next comparison
    prevDebugTextureRef.current = debugTexture;
    
    // Update selected cutout ref for next comparison
    prevSelectedCutoutIdRef.current = selectedCutoutId;
    prevSelectedInductionIdRef.current = selectedInductionId;
  }, [elements, selectedIds, library, pieceLayout, groups, debugTexture, forceRenderKey, selectedCutoutId, selectedInductionId]);

  // Helper functions
  const getColorById = (id) => library?.colors?.find(c => c.id === id) || { id: id, name: 'Material necunoscut', color: '#666666' };
  const getManufacturerForColor = (colorId) => {
    const color = library?.colors?.find(c => c.id === colorId);
    return color?.manufacturer || library?.manufacturers?.[0]?.id;
  };

  const getThicknessesForColor = (colorId) => {
    if (!library?.formats) return [12];
    return [...new Set(library.formats.filter(f => f.colorId === colorId).map(f => f.thickness))].sort((a, b) => a - b);
  };

  const addElement = (type) => {
    // Check element limits
    const stoneCount = elements.filter(e => e.type === 'island' || e.type === 'backsplash').length;
    const cabinetCount = elements.filter(e => e.type === 'cabinet').length;
    
    if (type === 'cabinet' && cabinetCount >= 30) {
      showNotification('Limită atinsă: maxim 30 corpuri de mobilier', 'error');
      return;
    }
    if ((type === 'island' || type === 'backsplash') && stoneCount >= 30) {
      showNotification('Limită atinsă: maxim 30 blaturi / contrablaturi', 'error');
      return;
    }
    
    // Cabinet doesn't need material from library
    if (type === 'cabinet') {
      const el = {
        id: generateId(),
        type: 'cabinet',
        name: 'Corp mobilier',
        width: 60,      // cm
        depth: 60,      // cm
        height: 90,     // cm (standard kitchen cabinet height)
        placementHeight: 0, // on floor
        color: '#4a4a4a', // default gray color
        position: { 
          x: 0.5,  // 50cm from wall
          z: 0.5   // 50cm from wall
        },
        rotation: 0,
      };
      setElements([...elements, el]);
      setSelectedId(el.id);
      return;
    }
    
    const firstColor = library?.colors?.[0];
    if (!firstColor) return; // Guard against no colors
    const thicknesses = getThicknessesForColor(firstColor?.id);
    
    // For blat (island type), prefer 12mm if available
    let defaultThickness;
    if (type === 'backsplash') {
      defaultThickness = thicknesses[0] || 12;
    } else {
      // Prefer 12mm for blat if available, otherwise use first available
      defaultThickness = thicknesses.includes(12) ? 12 : (thicknesses[0] || 12);
    }

    // Default dimensions
    const length = type === 'backsplash' ? 200 : 200;
    const depth = type === 'backsplash' ? 2 : 60;
    
    // Position inside the "room" - offset from origin walls by half-size + margin
    // This ensures the piece is fully inside the positive quadrant
    const lengthM = length / 100; // convert cm to meters
    const depthM = depth / 100;
    const margin = 0.2; // 20cm margin from walls
    
    const el = {
      id: generateId(),
      type,
      name: type === 'backsplash' ? 'Contrablat' : 'Blat',
      length,
      depth,
      height: type === 'backsplash' ? 60 : 90,
      placementHeight: type === 'backsplash' ? 90 : 90,
      thickness: defaultThickness,
      material: firstColor?.id,
      waterfallLeft: false,
      waterfallRight: false,
      position: { 
        x: lengthM / 2 + margin, // Center at x = half-length + margin
        z: depthM / 2 + margin   // Center at z = half-depth + margin
      },
      rotation: 0,
    };

    setElements([...elements, el]);
    setSelectedId(el.id);
  };

  const updateElement = (id, updates) => {
    // Tutorial: detect relevant actions
    if (tutorialStep !== null) {
      if (updates.length !== undefined || updates.depth !== undefined || updates.height !== undefined) {
        tutorialMarkAction('changed-dimension');
      }
      if (updates.cutouts && updates.cutouts.length > 0) {
        const el = elements.find(e => e.id === id);
        if (el && (!el.cutouts || updates.cutouts.length > el.cutouts.length)) {
          tutorialMarkAction('added-cutout');
        }
      }
      if (updates.rotation !== undefined) {
        tutorialMarkAction('rotated-element');
      }
    }
    
    setElements(elements.map(el => {
      if (el.id !== id) return el;
      
      // Check if length is changing and element has cutouts
      if (updates.length !== undefined && el.cutouts && el.cutouts.length > 0) {
        const oldLength = el.length;
        const newLength = updates.length;
        const lengthDelta = newLength - oldLength;
        
        if (lengthDelta !== 0) {
          // Reposition cutouts to maintain their cotaStânga (distance from left edge)
          // When piece grows symmetrically, the left edge moves LEFT by delta/2
          // So cutout center must move LEFT by delta/2 to stay at same cotaStânga
          // center.x is relative to piece center, so we SUBTRACT delta/2
          const updatedCutouts = el.cutouts.map(cutout => ({
            ...cutout,
            center: {
              ...cutout.center,
              x: cutout.center.x - lengthDelta / 2
            }
          }));
          
          return { ...el, ...updates, cutouts: updatedCutouts };
        }
      }
      
      // Same logic for depth/height changes (maintain cotaFață)
      const depthKey = el.type === 'backsplash' ? 'height' : 'depth';
      if (updates[depthKey] !== undefined && el.cutouts && el.cutouts.length > 0) {
        const oldDepth = el[depthKey];
        const newDepth = updates[depthKey];
        const depthDelta = newDepth - oldDepth;
        
        if (depthDelta !== 0) {
          // Reposition cutouts to maintain their cotaFață (distance from front edge)
          // Same logic - front edge moves forward by delta/2, so center moves by -delta/2
          const updatedCutouts = (updates.cutouts || el.cutouts).map(cutout => ({
            ...cutout,
            center: {
              ...cutout.center,
              z: cutout.center.z - depthDelta / 2
            }
          }));
          
          return { ...el, ...updates, cutouts: updatedCutouts };
        }
      }
      
      return { ...el, ...updates };
    }));
  };

  const removeElement = (id) => {
    setElements(elements.filter(el => el.id !== id));
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(sid => sid !== id));
    }
  };

  // Remove multiple selected elements
  const removeSelectedElements = () => {
    if (selectedIds.length === 0) return;
    setElements(elements.filter(el => !selectedIds.includes(el.id)));
    setSelectedIds([]);
  };

  // Group selected elements - creates parent with local offsets
  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    
    const selectedEls = elements.filter(el => selectedIds.includes(el.id));
    
    // Check if any selected element is already in a group
    const elementsInGroups = selectedEls.filter(el => el.groupId);
    if (elementsInGroups.length > 0) {
      // Show error notification
      showNotification('Nu poți grupa elemente care sunt deja într-un grup. Degrupează-le mai întâi (Ctrl+X).', 'error');
      return;
    }
    
    // Calculate center of selection (will be group position)
    const centerX = selectedEls.reduce((sum, el) => sum + (getWorldPosition(el).x), 0) / selectedEls.length;
    const centerZ = selectedEls.reduce((sum, el) => sum + (getWorldPosition(el).z), 0) / selectedEls.length;
    
    const groupId = generateId();
    
    // Create the group with center position
    const newGroup = {
      position: { x: centerX, z: centerZ },
      rotation: 0
    };
    
    // Update elements with local offsets relative to group center
    const updatedElements = elements.map(el => {
      if (!selectedIds.includes(el.id)) return el;
      
      const worldPos = getWorldPosition(el);
      const worldRot = getWorldRotation(el);
      
      // If element was in another group, we need to "bake" its world transform first
      // Then calculate new local offset from new group center
      return {
        ...el,
        groupId,
        localOffset: {
          x: worldPos.x - centerX,
          z: worldPos.z - centerZ
        },
        localRotation: worldRot,
        // Clear old position/rotation since we now use local coords
        position: undefined,
        rotation: undefined
      };
    });
    
    setGroups({ ...groups, [groupId]: newGroup });
    setElements(updatedElements);
  };

  // Ungroup selected elements - bakes world transforms back to elements
  const ungroupSelected = () => {
    if (selectedIds.length === 0) return;
    
    // Get all group IDs from selected elements
    const groupIdsToRemove = new Set(
      elements
        .filter(el => selectedIds.includes(el.id) && el.groupId)
        .map(el => el.groupId)
    );
    
    if (groupIdsToRemove.size === 0) return;
    
    // Bake world transforms back to elements and remove group references
    const updatedElements = elements.map(el => {
      if (!groupIdsToRemove.has(el.groupId)) return el;
      
      // Calculate final world position and rotation
      const worldPos = getWorldPosition(el);
      const worldRot = getWorldRotation(el);
      
      return {
        ...el,
        position: worldPos,
        rotation: worldRot,
        groupId: undefined,
        localOffset: undefined,
        localRotation: undefined
      };
    });
    
    // Remove the groups
    const newGroups = { ...groups };
    groupIdsToRemove.forEach(gid => delete newGroups[gid]);
    
    setGroups(newGroups);
    setElements(updatedElements);
    tutorialMarkAction('ungrouped');
  };

  // Get geometric center of selected elements (using world positions)
  const getSelectionCenter = () => {
    const selected = elements.filter(el => selectedIds.includes(el.id));
    if (selected.length === 0) return { x: 0, z: 0 };
    
    const sumX = selected.reduce((sum, el) => sum + getWorldPosition(el).x, 0);
    const sumZ = selected.reduce((sum, el) => sum + getWorldPosition(el).z, 0);
    
    return {
      x: sumX / selected.length,
      z: sumZ / selected.length
    };
  };

  // Select element with shift support for multi-select
  // Select element: Ctrl+Click = add to selection, Shift+Click = remove from selection
  const handleElementSelect = (id, { ctrlKey = false, shiftKey = false } = {}) => {
    const el = elements.find(e => e.id === id);
    
    // If element is in a group, select all group members
    if (el?.groupId) {
      const groupMembers = elements.filter(e => e.groupId === el.groupId).map(e => e.id);
      if (ctrlKey) {
        // Add group to selection
        setSelectedIds([...new Set([...selectedIds, ...groupMembers])]);
      } else if (shiftKey) {
        // Remove group from selection
        setSelectedIds(selectedIds.filter(sid => !groupMembers.includes(sid)));
      } else {
        // If clicking on already selected group member, don't change selection (allows drag)
        if (selectedIds.includes(id)) {
          return;
        }
        // Select only this group
        setSelectedIds(groupMembers);
      }
      return;
    }
    
    if (ctrlKey) {
      // Add to selection (if not already selected)
      if (!selectedIds.includes(id)) {
        setSelectedIds([...selectedIds, id]);
      }
    } else if (shiftKey) {
      // Remove from selection
      setSelectedIds(selectedIds.filter(sid => sid !== id));
    } else {
      // If clicking on already selected element, don't change selection (allows multi-drag)
      if (selectedIds.includes(id)) {
        return;
      }
      // Single select
      setSelectedIds([id]);
    }
  };

  // Generate unique name for copies - uses number suffix
  const generateCopyName = (baseName, existingElements) => {
    // Remove existing copy suffix like " (2)", " (3)" etc.
    const cleanName = baseName.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*\(copie\)\s*$/i, '').trim();
    
    // Find all elements with similar names and get max number
    let maxNum = 0;
    existingElements.forEach(el => {
      if (el.name === cleanName) {
        maxNum = Math.max(maxNum, 1);
      }
      const match = el.name.match(new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\((\\d+)\\)$`));
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1]));
      }
    });
    
    return `${cleanName} (${maxNum + 1})`;
  };

  const duplicateElement = (id) => {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    
    // For grouped elements, get world position
    const worldPos = getWorldPosition(el);
    const worldRot = getWorldRotation(el);
    
    const newEl = {
      ...el,
      id: generateId(),
      name: generateCopyName(el.name, elements),
      position: { x: worldPos.x + 0.3, z: worldPos.z + 0.3 },
      rotation: worldRot,
      // Remove group info for duplicated element
      groupId: undefined,
      localOffset: undefined,
      localRotation: undefined,
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
  };

  // Clipboard for copy/paste
  const [clipboard, setClipboard] = useState(null);
  const [notifications, setNotifications] = useState([]); // Array of { id, message, type, fading }
  
  const showNotification = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    
    // Add new notification
    setNotifications(prev => [...prev, { id, message, type, fading: false }]);
    
    // Start fade out after 3 seconds
    setTimeout(() => {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, fading: true } : n));
      // Remove after fade completes (500ms fade)
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 500);
    }, 3000);
  }, []);
  
  const copySelected = useCallback(() => {
    if (selectedIds.length === 0) {
      showNotification('Nimic selectat', 'error');
      return;
    }
    
    // Copy all selected elements with their world transforms
    const copied = elements
      .filter(el => selectedIds.includes(el.id))
      .map(el => ({
        ...el,
        position: getWorldPosition(el),
        rotation: getWorldRotation(el),
        // Remove group info
        groupId: undefined,
        localOffset: undefined,
        localRotation: undefined,
      }));
    
    setClipboard(copied);
    showNotification(`Copiat ${copied.length} element${copied.length > 1 ? 'e' : ''}`, 'success');
  }, [selectedIds, elements, getWorldPosition, getWorldRotation, showNotification]);
  
  const pasteClipboard = useCallback(() => {
    if (!clipboard || clipboard.length === 0) {
      showNotification('Clipboard gol', 'error');
      return;
    }
    
    // Build list including current elements for name generation
    let allElements = [...elements];
    const newElements = clipboard.map(el => {
      const newEl = {
        ...el,
        id: generateId(),
        name: generateCopyName(el.name, allElements),
        position: { 
          x: (el.position?.x || 0) + 0.3, 
          z: (el.position?.z || 0) + 0.3 
        },
        // Regenerate cutout IDs to avoid duplicates
        cutouts: el.cutouts?.map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) }))
      };
      allElements.push(newEl); // Add to list for next name generation
      return newEl;
    });
    
    setElements([...elements, ...newElements]);
    setSelectedIds(newElements.map(el => el.id));
    showNotification(`Lipit ${newElements.length} element${newElements.length > 1 ? 'e' : ''}`, 'success');
  }, [clipboard, elements, showNotification]);

  const selected = elements.find(el => el.id === selectedId);
  const selectedColor = selected ? getColorById(selected.material) : null;
  const selectedManufacturer = selected ? getManufacturerForColor(selected.material) : null;
  const availableThicknesses = selected ? getThicknessesForColor(selected.material) : [];
  const [collapsedSections, setCollapsedSections] = useState({});

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      
      // Delete selected elements
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) removeSelectedElements();
      }
      
      // Tool shortcuts
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey) setTool('move');
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) setTool('rotate');
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) setSnapEnabled(!snapEnabled);
      
      // Duplicate
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey && selectedIds.length === 1) {
        duplicateElement(selectedIds[0]);
      }
      
      // Escape - deselect all
      if (e.key === 'Escape') setSelectedIds([]);
      
      // Ctrl+G - Group selected
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        groupSelected();
      }
      
      // Ctrl+X - Ungroup (explode)
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey) {
        // Only ungroup if we have grouped elements selected
        const hasGrouped = elements.some(el => selectedIds.includes(el.id) && el.groupId);
        if (hasGrouped) {
          e.preventDefault();
          ungroupSelected();
        }
        // Otherwise let default cut behavior happen
      }
      
      // Ctrl+A - Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(elements.map(el => el.id));
      }
      
      // Ctrl+C - Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelected();
      }
      
      // Ctrl+V - Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteClipboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, snapEnabled, elements, copySelected, pasteClipboard]);

  const toolBtnStyle = (active) => ({
    height: '32px',
    padding: '0 10px',
    background: active ? 'rgba(201,169,98,0.15)' : '#111',
    border: active ? '1px solid #c9a962' : '1px solid #262626',
    color: active ? '#c9a962' : '#999',
    cursor: 'pointer',
    fontSize: '11px',
    borderRadius: '6px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    whiteSpace: 'nowrap',
    fontFamily: 'system-ui',
    lineHeight: 1,
    transition: 'all 0.15s ease',
  });

  // ============================================
  // GLB EXPORT FUNCTION (3D)
  // ============================================
  const exportGLB = () => {
    console.log('exportGLB called', { sceneRef, meshesRef, elements });
    
    if (!sceneRef || !sceneRef.current) {
      showNotification('Scena 3D nu este disponibilă', 'error');
      console.error('sceneRef not available:', sceneRef);
      return;
    }
    
    if (!meshesRef || !meshesRef.current || Object.keys(meshesRef.current).length === 0) {
      showNotification('Nu există elemente de exportat', 'error');
      console.error('meshesRef not available:', meshesRef);
      return;
    }
    
    // Create a new scene with only the elements (no grid, lights, etc.)
    const exportScene = new THREE.Scene();
    
    // Clone all element meshes into export scene
    Object.entries(meshesRef.current).forEach(([id, mesh]) => {
      const el = elements.find(e => e.id === id);
      if (!el) return;
      
      // Clone the mesh
      const clonedMesh = mesh.clone();
      
      // Remove outline children (LineSegments) - keep only the main geometry
      const childrenToRemove = [];
      clonedMesh.traverse((child) => {
        if (child.isLineSegments || child.isLine) {
          childrenToRemove.push(child);
        }
      });
      childrenToRemove.forEach(child => {
        if (child.parent) child.parent.remove(child);
      });
      
      // Set name for the mesh
      clonedMesh.name = el.name || `Element_${id}`;
      
      exportScene.add(clonedMesh);
    });
    
    console.log('Export scene created with', exportScene.children.length, 'objects');
    
    // Export using GLTFExporter
    const exporter = new GLTFExporter();
    
    exporter.parse(
      exportScene,
      (result) => {
        // result is an ArrayBuffer for binary GLB
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const link = document.createElement('a');
        link.href = url;
        link.download = `${project?.name || 'export'}.glb`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showNotification('Export GLB reușit!', 'success');
      },
      (error) => {
        console.error('GLB export error:', error);
        showNotification('Eroare la export GLB', 'error');
      },
      { binary: true } // Export as binary GLB
    );
  };

  // ============================================
  // EXPORT/IMPORT CONFIGURATION
  // ============================================
  const exportConfig = () => {
    const config = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projectName: project?.name || 'Untitled',
      elements: elements,
      groups: groups,
      manualLayoutPositions: manualLayoutPositions,
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project?.name || 'config'}_${new Date().toISOString().split('T')[0]}.eblat.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showNotification('Configurație exportată!', 'success');
  };
  
  const importConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.eblat.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const config = JSON.parse(event.target.result);
          
          // Validate config structure
          if (!config.elements || !Array.isArray(config.elements)) {
            showNotification('Fișier invalid - lipsesc elementele', 'error');
            return;
          }
          
          // Confirm import
          const confirmMsg = config.projectName 
            ? `Importi configurația "${config.projectName}"?\n\nAceasta va înlocui toate elementele existente.`
            : 'Importi această configurație?\n\nAceasta va înlocui toate elementele existente.';
          
          if (!window.confirm(confirmMsg)) return;
          
          // Import elements
          setElements(config.elements);
          
          // Import groups if present
          if (config.groups) {
            setGroups(config.groups);
          }
          
          // Import manual layout positions if present
          if (config.manualLayoutPositions) {
            setManualLayoutPositions(config.manualLayoutPositions);
          }
          
          // Clear selection
          setSelectedIds([]);
          
          showNotification(`Configurație importată: ${config.elements.length} elemente`, 'success');
        } catch (err) {
          console.error('Import error:', err);
          showNotification('Eroare la import - fișier invalid', 'error');
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  };

  // ============================================
  // TUTORIAL - state & callbacks (component is defined at module level)
  // ============================================
  
  const [tutorialActions, setTutorialActions] = useState({});
  
  const tutorialMarkAction = useCallback((action) => {
    setTutorialActions(prev => {
      if (prev[action]) return prev;
      return { ...prev, [action]: true };
    });
  }, []);

  const closeTutorial = useCallback((markComplete = true) => {
    setTutorialStep(null);
    setTutorialActions({});
    if (markComplete) {
      const key = `eblat_tutorial_completed_${user?.id || 'local'}`;
      localStorage.setItem(key, 'true');
    }
  }, [user?.id]);

  const advanceTutorial = useCallback(() => {
    setTutorialStep(prev => {
      if (prev === null) return null;
      if (prev >= TUTORIAL_STEPS.length - 1) return null;
      return prev + 1;
    });
  }, []);

  const goBackTutorial = useCallback(() => {
    setTutorialStep(prev => {
      if (prev === null || prev <= 0) return prev;
      return prev - 1;
    });
  }, []);

  // Tutorial: Detect element additions
  useEffect(() => {
    if (tutorialStepRef.current === null) return;
    const prevCount = tutorialElementCountRef.current;
    if (elements.length > prevCount) {
      const newest = elements[elements.length - 1];
      if (newest?.type === 'island') tutorialMarkAction('added-blat');
      if (newest?.type === 'backsplash') tutorialMarkAction('added-contrablat');
    }
    tutorialElementCountRef.current = elements.length;
  }, [elements.length, tutorialMarkAction]);

  // Tutorial: Detect blat selection (for cutout step)
  // Also re-check when tutorial step changes (blat might already be selected)
  useEffect(() => {
    if (tutorialStepRef.current === null) return;
    if (selectedIds.length > 0) {
      const selectedEl = elements.find(e => e.id === selectedIds[0]);
      if (selectedEl?.type === 'island') {
        tutorialMarkAction('selected-blat');
      }
    }
    // Detectează selecție multiplă (2+ elemente)
    if (selectedIds.length >= 2) {
      tutorialMarkAction('multi-selected');
    }
  }, [selectedIds, elements, tutorialMarkAction, tutorialStep]);

  // Tutorial: Detectează crearea unui grup
  useEffect(() => {
    if (tutorialStepRef.current === null) return;
    if (groups && Object.keys(groups).length > 0) {
      tutorialMarkAction('created-group');
    }
  }, [groups, tutorialMarkAction]);

  return (
    <div style={{ height: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #222', background: '#0d0d0d', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Logo & Navigation */}
        <button onClick={onBack} style={{ ...toolBtnStyle(false), color: '#666' }}>← Proiecte</button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginRight: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>e-blat<span style={{ color: '#c9a962' }}>.com</span></span>
          <span style={{ color: '#555', fontSize: '12px' }}>/ {project.name}</span>
          {saveStatus && <span style={{ fontSize: '10px', color: '#4a9' }}>✓</span>}
        </div>

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* View Tools */}
        <button onClick={() => setDebugTexture(!debugTexture)} style={{ ...toolBtnStyle(debugTexture), background: debugTexture ? 'rgba(147,112,219,0.15)' : '#111', borderColor: debugTexture ? '#9370db' : '#262626', color: debugTexture ? '#9370db' : '#999' }} title="Afișează textura completă pe piese selectate">
          🔍 Încadrare {debugTexture ? 'ON' : 'OFF'}
        </button>

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* File Operations */}
        <button onClick={exportConfig} style={toolBtnStyle(false)} title="Exportă configurația ca fișier JSON">💾 Export</button>
        <button onClick={importConfig} style={toolBtnStyle(false)} title="Importă configurație din fișier JSON">📂 Import</button>

        <div style={{ flex: 1 }} />

        {/* Transform Tools */}
        <div style={{ display: 'flex', gap: '3px' }}>
          <button onClick={() => setTool('select')} style={{ ...toolBtnStyle(tool === 'select'), borderRadius: '6px 0 0 6px' }}>↖ Select</button>
          <button onClick={() => setTool('move')} style={{ ...toolBtnStyle(tool === 'move'), borderRadius: 0 }}>✥ Move</button>
          <button onClick={() => setTool('rotate')} style={{ ...toolBtnStyle(tool === 'rotate'), borderRadius: '0 6px 6px 0' }}>↻ Rotate</button>
        </div>

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* Grouping */}
        <button onClick={groupSelected} disabled={selectedIds.length < 2} style={{ ...toolBtnStyle(false), opacity: selectedIds.length < 2 ? 0.35 : 1, cursor: selectedIds.length < 2 ? 'default' : 'pointer' }} title="Group (Ctrl+G)">⊞ Group</button>
        <button onClick={ungroupSelected} disabled={!elements.some(el => selectedIds.includes(el.id) && el.groupId)} style={{ ...toolBtnStyle(false), opacity: !elements.some(el => selectedIds.includes(el.id) && el.groupId) ? 0.35 : 1, cursor: !elements.some(el => selectedIds.includes(el.id) && el.groupId) ? 'default' : 'pointer' }} title="Ungroup (Ctrl+X)">⊟ Ungroup</button>

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* Snap */}
        <button onClick={() => setSnapEnabled(!snapEnabled)} style={{ ...toolBtnStyle(snapEnabled), background: snapEnabled ? 'rgba(74,153,74,0.12)' : '#111', borderColor: snapEnabled ? '#4a9' : '#262626', color: snapEnabled ? '#4a9' : '#999' }}>
          ⊞ Snap {snapEnabled ? 'ON' : 'OFF'}
        </button>
        {snapEnabled && (
          <select 
            value={snapThreshold} 
            onChange={e => setSnapThreshold(Number(e.target.value))}
            style={{ height: '32px', background: '#111', border: '1px solid #262626', color: '#4a9', fontSize: '11px', padding: '0 6px', borderRadius: '6px', cursor: 'pointer' }}
            title="Snap threshold"
          >
            <option value={5}>5cm</option>
            <option value={10}>10cm</option>
            <option value={15}>15cm</option>
            <option value={20}>20cm</option>
            <option value={25}>25cm</option>
            <option value={50}>50cm</option>
          </select>
        )}

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* Undo */}
        <button onClick={undo} disabled={undoHistory.length === 0} style={{ ...toolBtnStyle(false), opacity: undoHistory.length === 0 ? 0.35 : 1, cursor: undoHistory.length === 0 ? 'default' : 'pointer' }} title="Undo (Ctrl+Z)">↩ Undo</button>

        <div style={{ width: '1px', height: '20px', background: '#262626' }} />

        {/* Shortcuts hint & Tutorial */}
        <div style={{ fontSize: '9px', color: '#444', lineHeight: 1.4, maxWidth: '200px' }}>G=Move R=Rotate D=Dup Del=Șterge<br/>Ctrl+Click=Adaugă Ctrl+G=Group</div>
        <button 
          onClick={() => { tutorialElementCountRef.current = elements.length; setTutorialStep(0); }}
          style={toolBtnStyle(false)}
          title="Pornește tutorial-ul"
        >
          ❓ Tutorial
        </button>
      </div>

      {/* Material Warnings Banner */}
      {materialWarnings.length > 0 && (
        <div style={{ 
          background: 'rgba(201,98,98,0.15)', 
          borderBottom: '1px solid rgba(201,98,98,0.3)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <span style={{ color: '#c96262' }}>⚠️</span>
          <div style={{ flex: 1, fontSize: '12px', color: '#c96262' }}>
            {materialWarnings.filter(w => w.type === 'missing').length > 0 && (
              <span>
                {materialWarnings.filter(w => w.type === 'missing').length} piesă(e) cu material inexistent.{' '}
              </span>
            )}
            {materialWarnings.filter(w => w.type === 'archived').length > 0 && (
              <span>
                {materialWarnings.filter(w => w.type === 'archived').length} piesă(e) cu material arhivat (vor fi afișate dar nu pot fi selectate pentru piese noi).
              </span>
            )}
          </div>
          <button 
            onClick={() => setMaterialWarnings([])}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: '#c96262', 
              cursor: 'pointer',
              fontSize: '16px',
              padding: '4px 8px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left Panel - Elements */}
        <div style={{ width: '220px', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>ADAUGĂ ELEMENT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <button data-tutorial="add-blat" onClick={() => addElement('island')} style={{ padding: '8px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', cursor: 'pointer', fontSize: '11px', textAlign: 'left', borderRadius: '4px' }}>+ Blat</button>
              <button data-tutorial="add-contrablat" onClick={() => addElement('backsplash')} style={{ padding: '8px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', cursor: 'pointer', fontSize: '11px', textAlign: 'left', borderRadius: '4px' }}>+ Contrablat</button>
              <button onClick={() => addElement('cabinet')} style={{ padding: '8px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#888', cursor: 'pointer', fontSize: '11px', textAlign: 'left', borderRadius: '4px' }}>+ Corp mobilier</button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
              ELEMENTE ({elements.length})
              {selectedIds.length > 1 && <span style={{ color: '#c9a962', marginLeft: '8px' }}>{selectedIds.length} selectate</span>}
            </div>
            {elements.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '11px' }}>Adaugă un element</div>
            ) : elements.map((el, index) => {
              const isSelected = selectedIds.includes(el.id);
              const hasGroup = el.groupId;
              const groupColorData = getGroupColor(el.groupId);
              const groupColor = groupColorData?.hsl;
              
              // Get piece numbers for this element from layout
              const elementPieces = layoutData.pieces?.filter(p => p.elementId === el.id) || [];
              const pieceNumbers = elementPieces.map(p => p.pieceNumber).filter(Boolean);
              const pieceNumberStr = pieceNumbers.length > 0 ? pieceNumbers.sort((a,b) => {
                const numA = parseInt(a.replace(/\D/g, ''));
                const numB = parseInt(b.replace(/\D/g, ''));
                return numA - numB;
              }).join(', ') : `${index + 1}`;
              
              // Check if any piece exceeds tile dimensions
              const hasExceedingPiece = elementPieces.some(p => p.exceeds);
              
              // Cutouts info
              const cutouts = el.cutouts || [];
              const hasCutouts = cutouts.length > 0;
              
              return (
                <div
                  key={el.id}
                  onClick={(e) => handleElementSelect(el.id, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey })}
                  style={{
                    padding: '10px',
                    marginBottom: '6px',
                    cursor: 'pointer',
                    background: isSelected ? (groupColorData ? `hsla(${groupColorData.hue}, 60%, 50%, 0.15)` : 'rgba(201,169,98,0.15)') : '#1a1a1a',
                    borderTop: `2px solid ${isSelected ? (groupColor || '#c9a962') : '#2a2a2a'}`,
                    borderRight: `2px solid ${isSelected ? (groupColor || '#c9a962') : '#2a2a2a'}`,
                    borderBottom: `2px solid ${isSelected ? (groupColor || '#c9a962') : '#2a2a2a'}`,
                    borderLeft: hasGroup ? `4px solid ${groupColor}` : (hasExceedingPiece ? '4px solid #c96262' : `2px solid ${isSelected ? (groupColor || '#c9a962') : '#2a2a2a'}`),
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ 
                          color: hasExceedingPiece ? '#c96262' : '#c9a962', 
                          fontWeight: 700,
                          minWidth: '20px'
                        }}>
                          {pieceNumberStr}
                        </span>
                        {el.name}
                        {hasGroup && <span style={{ fontSize: '9px', color: groupColor, background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px' }}>GRUP</span>}
                        {hasExceedingPiece && <span style={{ fontSize: '9px', color: '#c96262', background: 'rgba(201,98,98,0.2)', padding: '1px 4px', borderRadius: '3px' }}>⚠️</span>}
                        {el.type === 'cabinet' && <span style={{ fontSize: '9px', color: '#888', background: 'rgba(150,150,150,0.2)', padding: '1px 4px', borderRadius: '3px' }}>MOBILIER</span>}
                      </div>
                      {el.type === 'cabinet' ? (
                        <div style={{ fontSize: '10px', color: '#666' }}>{el.width}×{el.depth}×{el.height}cm</div>
                      ) : (
                        <div style={{ fontSize: '10px', color: hasExceedingPiece ? '#c96262' : '#666' }}>{el.length}×{el.type === 'backsplash' ? el.height : el.depth}cm • {el.thickness}mm</div>
                      )}
                      {el.type === 'cabinet' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                          <div style={{ width: '12px', height: '12px', background: el.color || '#4a4a4a', borderRadius: '2px', border: '1px solid #333' }} />
                          <span style={{ fontSize: '10px', color: '#888' }}>Culoare personalizată</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                          <div style={{ width: '12px', height: '12px', background: getColorById(el.material)?.color, borderRadius: '2px', border: '1px solid #333' }} />
                          <span style={{ fontSize: '10px', color: '#888' }}>{getColorById(el.material)?.name}</span>
                        </div>
                      )}
                      {hasCutouts && (
                        <div style={{ fontSize: '9px', color: '#888', marginTop: '6px' }}>
                          <div style={{ marginBottom: '2px' }}>✂️ Goluri:</div>
                          {cutouts.map((c, i) => {
                            const dim = c.type === 'circle' 
                              ? `Ø${(c.radius * 2).toFixed(1)}cm`
                              : `${c.width}×${c.height}cm`;
                            return (
                              <div key={c.id} style={{ paddingLeft: '12px', color: '#666' }}>
                                <span style={{ color: '#c9a962' }}>{index + 1}.{String(i + 1).padStart(2, '0')}</span> {c.name} <span style={{ color: '#555' }}>({dim})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeElement(el.id); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center - 3D View */}
        <div data-tutorial="canvas-3d" style={{ flex: 1, position: 'relative', background: '#111', minWidth: 0 }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          
          {/* Marquee Selection Rectangle */}
          {marqueeRect && (
            <div style={{
              position: 'absolute',
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
              border: '1px solid #c9a962',
              background: 'rgba(201, 169, 98, 0.1)',
              pointerEvents: 'none',
              zIndex: 50,
            }} />
          )}
          
          {/* Notifications Stack */}
          {notifications.length > 0 && (
            <div style={{ 
              position: 'absolute', 
              top: '12px', 
              left: '12px', 
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              zIndex: 100,
              pointerEvents: 'none',
            }}>
              {notifications.map((notification) => (
                <div 
                  key={notification.id}
                  style={{ 
                    background: notification.type === 'success' ? 'rgba(74,153,74,0.95)' : 'rgba(201,98,98,0.95)', 
                    color: '#fff', 
                    padding: '8px 16px', 
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    opacity: notification.fading ? 0 : 1,
                    transform: notification.fading ? 'translateX(-20px)' : 'translateX(0)',
                    transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
                  }}>
                  {notification.type === 'success' ? '✓' : '✗'} {notification.message}
                </div>
              ))}
            </div>
          )}
          
          {elements.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', pointerEvents: 'none' }}>
              Adaugă un element pentru a începe
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', fontSize: '10px', color: '#555', background: 'rgba(0,0,0,0.7)', padding: '6px 12px', borderRadius: '4px' }}>
            {tool === 'move' 
              ? '🖱️ Click + Drag = Mută • Middle-click/Alt = Orbit • Right-click = Pan • Scroll = Zoom' 
              : tool === 'rotate'
              ? '🖱️ Click + Drag = Rotește • Middle-click/Alt = Orbit • Right-click = Pan • Scroll = Zoom'
              : '🖱️ Click = Selectează • Middle-click/Alt = Orbit • Right-click = Pan • Scroll/Pinch = Zoom'}
          </div>
        </div>

        {/* Right Panel - Properties */}
        <div data-tutorial="properties-panel" style={{ width: '300px', borderLeft: '1px solid #2a2a2a', overflow: 'auto', flexShrink: 0 }}>
          {selectedIds.length > 1 ? (
            // Multi-select panel
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '16px' }}>SELECȚIE MULTIPLĂ</div>
              
              <div style={{ 
                background: 'rgba(201,169,98,0.1)', 
                border: '1px solid rgba(201,169,98,0.3)', 
                borderRadius: '8px', 
                padding: '16px',
                textAlign: 'center',
                marginBottom: '16px'
              }}>
                <div style={{ fontSize: '32px', color: '#c9a962', fontWeight: 700 }}>{selectedIds.length}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>elemente selectate</div>
              </div>
              
              {/* Cabinet color change for multiple cabinets */}
              {(() => {
                const selectedCabinets = elements.filter(el => selectedIds.includes(el.id) && el.type === 'cabinet');
                if (selectedCabinets.length > 0) {
                  const updateAllCabinetsColor = (newColor) => {
                    const cabinetIds = selectedCabinets.map(c => c.id);
                    setElements(prev => prev.map(el => 
                      cabinetIds.includes(el.id) ? { ...el, color: newColor } : el
                    ));
                  };
                  return (
                    <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                      <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px', fontWeight: 600 }}>
                        🎨 CULOARE CORPURI ({selectedCabinets.length})
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input 
                          type="color" 
                          value={selectedCabinets[0]?.color || '#4a4a4a'} 
                          onChange={e => updateAllCabinetsColor(e.target.value)} 
                          style={{ 
                            width: '40px', 
                            height: '40px', 
                            border: '1px solid #333', 
                            borderRadius: '4px', 
                            cursor: 'pointer',
                            padding: 0,
                            background: 'transparent'
                          }} 
                        />
                        <span style={{ fontSize: '11px', color: '#666' }}>Aplică la toate corpurile selectate</span>
                      </div>
                      {/* Quick color presets */}
                      <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                        {['#2a2a2a', '#4a4a4a', '#6a6a6a', '#8a8a8a', '#f5f5f5', '#8B4513', '#D2691E', '#F5DEB3'].map(c => (
                          <div 
                            key={c}
                            onClick={() => updateAllCabinetsColor(c)}
                            style={{ 
                              width: '24px', 
                              height: '24px', 
                              background: c, 
                              border: '1px solid #333',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '12px' }}>
                Poți să:
              </div>
              <ul style={{ fontSize: '11px', color: '#888', margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                <li>Muți toate elementele împreună (G + drag)</li>
                <li>Rotești în jurul centrului geometric (R + drag)</li>
                <li>Grupezi pentru a le păstra împreună (Ctrl+G)</li>
                <li>Ștergi toate (Delete)</li>
              </ul>
              
              {elements.some(el => selectedIds.includes(el.id) && el.groupId) && (
                <div style={{ marginTop: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '8px' }}>GRUPURI ÎN SELECȚIE</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>
                    Unele elemente sunt deja grupate. Folosește Ctrl+X pentru a le degrupa.
                  </div>
                </div>
              )}
            </div>
          ) : selected ? (
            selected.type === 'cabinet' ? (
              // Cabinet properties panel
              <div style={{ padding: '12px' }}>
                {/* Header with type badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#888' }}>PROPRIETĂȚI</div>
                  <div style={{ 
                    fontSize: '10px', 
                    padding: '2px 8px', 
                    background: 'rgba(150,150,150,0.2)',
                    color: '#999',
                    borderRadius: '4px'
                  }}>
                    CORP MOBILIER
                  </div>
                </div>

                {/* Name */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Nume</label>
                  <input type="text" value={selected.name} onChange={e => updateElement(selected.id, { name: e.target.value })} style={{ ...inputStyle, padding: '8px' }} />
                </div>

                {/* Dimensions Section */}
                <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px', fontWeight: 600 }}>📐 DIMENSIUNI</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Lățime (cm)</label>
                      <NumericInput value={selected.width || 60} onChange={v => updateElement(selected.id, { width: v })} min={1} style={{ ...inputStyle, padding: '8px' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Adâncime (cm)</label>
                      <NumericInput value={selected.depth || 60} onChange={v => updateElement(selected.id, { depth: v })} min={1} style={{ ...inputStyle, padding: '8px' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Înălțime (cm)</label>
                      <NumericInput value={selected.height || 85} onChange={v => updateElement(selected.id, { height: v })} min={1} style={{ ...inputStyle, padding: '8px' }} />
                    </div>
                  </div>
                  
                  {/* Placement Height */}
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Cotă montaj (cm)</label>
                    <NumericInput 
                      value={selected.placementHeight || 0} 
                      onChange={v => updateElement(selected.id, { placementHeight: v })} 
                      min={0} 
                      style={{ ...inputStyle, padding: '8px' }} 
                    />
                    <div style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                      0 = pe podea
                    </div>
                  </div>
                </div>

                {/* Doors & Drawers Section */}
                <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px', fontWeight: 600 }}>🚪 UȘI & SERTARE</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Uși (verticale)</label>
                      <NumericInput 
                        value={selected.doors || 0} 
                        onChange={v => updateElement(selected.id, { doors: v, drawers: v > 0 ? 0 : selected.drawers })} 
                        min={0} 
                        max={3}
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Sertare (orizontale)</label>
                      <NumericInput 
                        value={selected.drawers || 0} 
                        onChange={v => updateElement(selected.id, { drawers: v, doors: v > 0 ? 0 : selected.doors })} 
                        min={0} 
                        max={5}
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '9px', color: '#666', marginTop: '8px' }}>
                    {selected.doors > 1 && `${selected.doors - 1} linie verticală`}
                    {selected.doors > 2 && 'e'}
                    {selected.drawers > 1 && `${selected.drawers - 1} linie orizontală`}
                    {selected.drawers > 2 && 'e'}
                    {!selected.doors && !selected.drawers && 'Setează numărul de uși sau sertare'}
                  </div>
                </div>

                {/* Color Section */}
                <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px', fontWeight: 600 }}>🎨 CULOARE</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="color" 
                      value={selected.color || '#4a4a4a'} 
                      onChange={e => updateElement(selected.id, { color: e.target.value })} 
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        border: '1px solid #333', 
                        borderRadius: '4px', 
                        cursor: 'pointer',
                        padding: 0,
                        background: 'transparent'
                      }} 
                    />
                    <input 
                      type="text" 
                      value={selected.color || '#4a4a4a'} 
                      onChange={e => updateElement(selected.id, { color: e.target.value })} 
                      style={{ ...inputStyle, padding: '8px', flex: 1, textTransform: 'uppercase' }} 
                    />
                  </div>
                  {/* Quick color presets */}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {['#2a2a2a', '#4a4a4a', '#6a6a6a', '#8a8a8a', '#f5f5f5', '#8B4513', '#D2691E', '#F5DEB3'].map(c => (
                      <div 
                        key={c}
                        onClick={() => updateElement(selected.id, { color: c })}
                        style={{ 
                          width: '24px', 
                          height: '24px', 
                          background: c, 
                          border: selected.color === c ? '2px solid #c9a962' : '1px solid #333',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Position Section */}
                <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px', fontWeight: 600 }}>📍 POZIȚIE</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>X (cm)</label>
                      <NumericInput 
                        value={Math.round(getWorldPosition(selected).x * 100)} 
                        onChange={v => {
                          if (selected.groupId) {
                            // For grouped elements, update localOffset
                            const group = groups[selected.groupId];
                            if (group) {
                              const newLocalX = v / 100 - group.position.x;
                              updateElement(selected.id, { localOffset: { ...selected.localOffset, x: newLocalX } });
                            }
                          } else {
                            updateElement(selected.id, { position: { ...selected.position, x: v / 100 } });
                          }
                        }} 
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Z (cm)</label>
                      <NumericInput 
                        value={Math.round(getWorldPosition(selected).z * 100)} 
                        onChange={v => {
                          if (selected.groupId) {
                            const group = groups[selected.groupId];
                            if (group) {
                              const newLocalZ = v / 100 - group.position.z;
                              updateElement(selected.id, { localOffset: { ...selected.localOffset, z: newLocalZ } });
                            }
                          } else {
                            updateElement(selected.id, { position: { ...selected.position, z: v / 100 } });
                          }
                        }} 
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Rotație (°)</label>
                      <NumericInput 
                        value={Math.round(getWorldRotation(selected))} 
                        onChange={v => {
                          if (selected.groupId) {
                            const group = groups[selected.groupId];
                            if (group) {
                              const newLocalRot = v - (group.rotation || 0);
                              updateElement(selected.id, { localRotation: newLocalRot });
                            }
                          } else {
                            updateElement(selected.id, { rotation: v });
                          }
                        }} 
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding: '12px', background: 'rgba(150,150,150,0.1)', borderRadius: '6px', border: '1px solid #333' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>
                    ℹ️ Corpurile de mobilier sunt doar pentru vizualizare și nu intră în calculul plăcilor.
                  </div>
                </div>
              </div>
            ) : (
            <div style={{ padding: '12px' }}>
              {/* Header with type badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#888' }}>PROPRIETĂȚI</div>
                <div style={{ 
                  fontSize: '10px', 
                  padding: '2px 8px', 
                  background: selected.type === 'backsplash' ? 'rgba(169,201,98,0.2)' : 'rgba(201,169,98,0.2)',
                  color: selected.type === 'backsplash' ? '#a9c962' : '#c9a962',
                  borderRadius: '4px'
                }}>
                  {selected.type === 'backsplash' ? 'CONTRABLAT' : 'BLAT'}
                </div>
              </div>

              {/* Name */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Nume</label>
                <input type="text" value={selected.name} onChange={e => updateElement(selected.id, { name: e.target.value })} style={{ ...inputStyle, padding: '8px' }} />
              </div>

              {/* Dimensions Section */}
              <div style={{ marginBottom: collapsedSections.dimensions ? '10px' : '16px', padding: collapsedSections.dimensions ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div onClick={() => setCollapsedSections(s => ({ ...s, dimensions: !s.dimensions }))} style={{ fontSize: '10px', color: '#c9a962', padding: collapsedSections.dimensions ? '6px 12px' : '0', marginBottom: collapsedSections.dimensions ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                  <span>📐 DIMENSIUNI</span>
                  <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.dimensions ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                </div>
                {!collapsedSections.dimensions && (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Lungime (cm)</label>
                    <NumericInput value={selected.length} onChange={v => updateElement(selected.id, { length: v })} min={1} style={{ ...inputStyle, padding: '8px', borderColor: selected.length > 320 ? '#c96262' : undefined, background: selected.length > 320 ? 'rgba(201,98,98,0.1)' : undefined }} />
                    {selected.length > 320 && (
                      <div style={{ fontSize: '9px', color: '#c96262', marginTop: '4px' }}>
                        ⚠️ Depășește 320cm
                      </div>
                    )}
                  </div>
                  <div>
                    {(() => {
                      const widthValue = selected.type === 'backsplash' ? selected.height : selected.depth;
                      const exceedsWidth = widthValue > 160;
                      return (
                        <>
                          <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>{selected.type === 'backsplash' ? 'Înălțime' : 'Adâncime'} (cm)</label>
                          <NumericInput value={widthValue} onChange={v => updateElement(selected.id, selected.type === 'backsplash' ? { height: v } : { depth: v })} min={1} style={{ ...inputStyle, padding: '8px', borderColor: exceedsWidth ? '#c96262' : undefined, background: exceedsWidth ? 'rgba(201,98,98,0.1)' : undefined }} />
                          {exceedsWidth && (
                            <div style={{ fontSize: '9px', color: '#c96262', marginTop: '4px' }}>
                              ⚠️ Depășește 160cm
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                
                {/* Placement Height */}
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Înălțime montaj (cm)</label>
                  <NumericInput 
                    value={selected.placementHeight || 0} 
                    onChange={v => {
                      const currentWaterfallHeight = selected.waterfallHeight || selected.placementHeight || 90;
                      const hasWaterfall = selected.waterfallLeft || selected.waterfallRight;
                      // If placement height < waterfall height, reduce waterfall height
                      if (hasWaterfall && v < currentWaterfallHeight) {
                        updateElement(selected.id, { placementHeight: v, waterfallHeight: v });
                      } else {
                        updateElement(selected.id, { placementHeight: v });
                      }
                    }} 
                    min={0} 
                    style={{ ...inputStyle, padding: '8px' }} 
                  />
                </div>
                
                {/* Rotation */}
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Rotație (°)</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <NumericInput value={selected.rotation || 0} onChange={v => updateElement(selected.id, { rotation: v })} style={{ ...inputStyle, padding: '8px', flex: 1 }} />
                    <button 
                      onClick={() => updateElement(selected.id, { rotation: ((selected.rotation || 0) + 90) % 360 })}
                      style={{ ...secondaryBtnStyle, padding: '8px 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
                    >
                      +90°
                    </button>
                  </div>
                </div>
                
                {/* Grain Direction Toggle */}
                {(() => {
                  const format = library.formats.find(f => f.colorId === selected.material && f.thickness === selected.thickness) || { length: 320, width: 160 };
                  const pieceLength = selected.length;
                  const pieceDepth = selected.type === 'backsplash' ? selected.height : selected.depth;
                  
                  // Check if piece can be rotated (length must fit on tile width)
                  const canRotate = pieceLength <= format.width;
                  // Check if piece fits normally (length on tile length)
                  const canFitNormal = pieceLength <= format.length && pieceDepth <= format.width;
                  
                  return (
                    <div style={{ marginTop: '10px' }}>
                      <button
                        onClick={() => {
                          const newValue = selected.grainLengthwise === false ? true : false;
                          const canApply = newValue ? canFitNormal : canRotate;
                          if (canApply) updateElement(selected.id, { grainLengthwise: newValue });
                        }}
                        disabled={selected.grainLengthwise === false ? !canFitNormal : !canRotate}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'rgba(201,169,98,0.1)',
                          border: '1px solid #c9a962',
                          color: '#c9a962',
                          borderRadius: '4px',
                          cursor: (selected.grainLengthwise === false ? canFitNormal : canRotate) ? 'pointer' : 'not-allowed',
                          fontSize: '11px',
                          opacity: (selected.grainLengthwise === false ? canFitNormal : canRotate) ? 1 : 0.4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                        title={`Placă: ${format.length}×${format.width}cm | Piesă: ${pieceLength}×${pieceDepth}cm`}
                      >
                        <span style={{ fontSize: '14px' }}>⟳</span>
                        Rotește încadrarea
                        <span style={{ fontSize: '9px', color: '#888' }}>
                          ({selected.grainLengthwise === false ? `${pieceLength}×${pieceDepth}` : `${pieceDepth}×${pieceLength}`} pe placă)
                        </span>
                      </button>
                    </div>
                  );
                })()}
                
                {/* Area calculation */}
                <div style={{ marginTop: '8px', padding: '6px 8px', background: '#1a1a1a', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#666' }}>Suprafață:</span>
                  <span style={{ fontSize: '12px', color: '#c9a962', fontWeight: 600 }}>
                    {((selected.length * (selected.type === 'backsplash' ? selected.height : selected.depth)) / 10000).toFixed(3)} m²
                  </span>
                </div>
                </>)}
              </div>

              {/* Waterfall - only for blat type, moved here after dimensions */}
              {selected.type === 'island' && (
                <div style={{ marginBottom: collapsedSections.waterfall ? '10px' : '16px', padding: collapsedSections.waterfall ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div onClick={() => setCollapsedSections(s => ({ ...s, waterfall: !s.waterfall }))} style={{ fontSize: '10px', color: '#c9a962', padding: collapsedSections.waterfall ? '6px 12px' : '0', marginBottom: collapsedSections.waterfall ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                    <span>✨ CASCADĂ (WATERFALL)</span>
                    <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.waterfall ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                  </div>
                  {!collapsedSections.waterfall && (<>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', padding: '8px 12px', background: selected.waterfallLeft ? 'rgba(201,169,98,0.2)' : '#1a1a1a', border: `1px solid ${selected.waterfallLeft ? '#c9a962' : '#333'}`, borderRadius: '4px', flex: 1, justifyContent: 'center' }}>
                      <input type="checkbox" checked={selected.waterfallLeft || false} onChange={e => updateElement(selected.id, { waterfallLeft: e.target.checked })} style={{ display: 'none' }} />
                      ◀ Stânga
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', padding: '8px 12px', background: selected.waterfallRight ? 'rgba(201,169,98,0.2)' : '#1a1a1a', border: `1px solid ${selected.waterfallRight ? '#c9a962' : '#333'}`, borderRadius: '4px', flex: 1, justifyContent: 'center' }}>
                      <input type="checkbox" checked={selected.waterfallRight || false} onChange={e => updateElement(selected.id, { waterfallRight: e.target.checked })} style={{ display: 'none' }} />
                      Dreapta ▶
                    </label>
                  </div>
                  {(selected.waterfallLeft || selected.waterfallRight) && (
                    <div>
                      <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Înălțime cascadă (cm)</label>
                      <NumericInput 
                        value={selected.waterfallHeight || selected.placementHeight || 90} 
                        onChange={v => {
                          const currentPlacementHeight = selected.placementHeight || 0;
                          // If waterfall height > placement height, increase placement height
                          if (v > currentPlacementHeight) {
                            updateElement(selected.id, { waterfallHeight: v, placementHeight: v });
                          } else {
                            updateElement(selected.id, { waterfallHeight: v });
                          }
                        }} 
                        min={1} 
                        style={{ ...inputStyle, padding: '8px' }} 
                      />
                    </div>
                  )}
                  </>)}
                </div>
              )}

              {/* Material Section - Cascading selectors with gallery */}
              <div style={{ marginBottom: collapsedSections.material ? '10px' : '16px', padding: collapsedSections.material ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div onClick={() => setCollapsedSections(s => ({ ...s, material: !s.material }))} style={{ fontSize: '10px', color: '#c9a962', padding: collapsedSections.material ? '6px 12px' : '0', marginBottom: collapsedSections.material ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                  <span>🎨 MATERIAL</span>
                  <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.material ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                </div>
                {!collapsedSections.material && (<>
                
                {/* Material Type */}
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Tip Material</label>
                  <select 
                    value={(() => {
                      const color = library.colors.find(c => c.id === selected.material);
                      const mfr = library.manufacturers.find(m => m.id === color?.manufacturer);
                      return mfr?.materialType || '';
                    })()}
                    onChange={e => {
                      const firstMfr = library.manufacturers.find(m => m.materialType === e.target.value);
                      const firstColor = library.colors.find(c => c.manufacturer === firstMfr?.id);
                      if (firstColor) {
                        const thicknesses = getThicknessesForColor(firstColor.id);
                        const preferredThickness = thicknesses.includes(12) ? 12 : (thicknesses[0] || selected.thickness);
                        updateElement(selected.id, { 
                          material: firstColor.id,
                          thickness: preferredThickness
                        });
                      }
                    }}
                    style={{ ...inputStyle, padding: '8px' }}
                  >
                    {library.materialTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
                    ))}
                  </select>
                </div>

                {/* Manufacturer */}
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Producător</label>
                  <select 
                    value={selectedManufacturer || ''}
                    onChange={e => {
                      const firstColor = library.colors.find(c => c.manufacturer === e.target.value);
                      if (firstColor) {
                        const thicknesses = getThicknessesForColor(firstColor.id);
                        const preferredThickness = thicknesses.includes(12) ? 12 : (thicknesses[0] || selected.thickness);
                        updateElement(selected.id, { 
                          material: firstColor.id,
                          thickness: preferredThickness
                        });
                      }
                    }}
                    style={{ ...inputStyle, padding: '8px' }}
                  >
                    {(() => {
                      const color = library.colors.find(c => c.id === selected.material);
                      const mfr = library.manufacturers.find(m => m.id === color?.manufacturer);
                      const materialType = mfr?.materialType;
                      return library.manufacturers
                        .filter(m => m.materialType === materialType)
                        .map(m => {
                          const colorCount = library.colors.filter(c => c.manufacturer === m.id && !c.archived).length;
                          return <option key={m.id} value={m.id}>{m.name} ({colorCount} culori)</option>;
                        });
                    })()}
                  </select>
                </div>

                {/* Color Gallery */}
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '6px' }}>
                    Culoare / Finisaj
                    <span style={{ color: '#888', marginLeft: '6px' }}>
                      ({library.colors.filter(c => c.manufacturer === selectedManufacturer && !c.archived).length} disponibile)
                    </span>
                  </label>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(3, 1fr)', 
                    gap: '8px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    padding: '4px'
                  }}>
                    {/* Show active colors + current material if archived */}
                    {library.colors
                      .filter(c => c.manufacturer === selectedManufacturer && (!c.archived || c.id === selected.material))
                      .map(c => {
                      const isSelected = selected.material === c.id;
                      const isArchived = c.archived;
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (isArchived && !isSelected) return; // Can't select archived unless already selected
                            const thicknesses = getThicknessesForColor(c.id);
                            const preferredThickness = thicknesses.includes(selected.thickness) 
                              ? selected.thickness 
                              : (thicknesses.includes(12) ? 12 : (thicknesses[0] || selected.thickness));
                            updateElement(selected.id, { 
                              material: c.id,
                              thickness: preferredThickness
                            });
                          }}
                          style={{
                            aspectRatio: '1',
                            background: c.texture ? `url(${c.texture}) center/cover` : c.color,
                            borderRadius: '6px',
                            border: isSelected ? '3px solid #c9a962' : isArchived ? '2px solid #c96262' : '2px solid #333',
                            cursor: isArchived && !isSelected ? 'not-allowed' : 'pointer',
                            position: 'relative',
                            boxShadow: isSelected ? '0 0 12px rgba(201,169,98,0.6)' : 'none',
                            transition: 'all 0.15s ease',
                            opacity: isArchived && !isSelected ? 0.5 : 1,
                          }}
                          title={isArchived ? `${c.name} (ARHIVAT)` : c.name}
                        >
                          {/* Archived indicator */}
                          {isArchived && (
                            <div style={{
                              position: 'absolute',
                              top: '2px',
                              left: '2px',
                              background: 'rgba(201,98,98,0.9)',
                              color: '#fff',
                              fontSize: '8px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 600,
                            }}>
                              ARH
                            </div>
                          )}
                          {/* Info button for texture preview */}
                          {c.texture && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setTexturePreview({ texture: c.texture, name: c.name });
                                // Trigger fade in după ce componenta e montată
                                setTimeout(() => setTexturePreviewVisible(true), 10);
                              }}
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                background: 'rgba(0,0,0,0.7)',
                                borderRadius: '50%',
                                width: '18px',
                                height: '18px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                color: '#fff',
                                cursor: 'pointer',
                                border: '1px solid rgba(255,255,255,0.3)',
                                fontWeight: 600,
                                fontStyle: 'italic',
                                fontFamily: 'Georgia, serif',
                                padding: 0,
                              }}
                              title="Vezi textura completă"
                            >i</button>
                          )}
                          {/* Color name at bottom */}
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: 'rgba(0,0,0,0.7)',
                            padding: '3px 4px',
                            fontSize: '9px',
                            color: '#fff',
                            textAlign: 'center',
                            borderRadius: '0 0 4px 4px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>{c.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Thickness */}
                <div>
                  <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: '4px' }}>Grosime</label>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {(availableThicknesses.length > 0 ? availableThicknesses : [6, 12, 20, 30]).map(t => (
                      <button
                        key={t}
                        onClick={() => updateElement(selected.id, { thickness: t })}
                        style={{
                          padding: '6px 12px',
                          background: selected.thickness === t ? 'rgba(201,169,98,0.2)' : '#1a1a1a',
                          border: `1px solid ${selected.thickness === t ? '#c9a962' : '#333'}`,
                          color: selected.thickness === t ? '#c9a962' : '#888',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px',
                        }}
                      >
                        {t}mm
                      </button>
                    ))}
                  </div>
                </div>
                </>)}
              </div>

              {/* Notes */}
              <div style={{ marginBottom: collapsedSections.notes ? '10px' : '16px', padding: collapsedSections.notes ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div onClick={() => setCollapsedSections(s => ({ ...s, notes: !s.notes }))} style={{ fontSize: '10px', color: '#c9a962', padding: collapsedSections.notes ? '6px 12px' : '0', marginBottom: collapsedSections.notes ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                  <span>📝 NOTE</span>
                  <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.notes ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                </div>
                {!collapsedSections.notes && (
                <textarea 
                  value={selected.notes || ''} 
                  onChange={e => updateElement(selected.id, { notes: e.target.value })}
                  placeholder="Notițe, instrucțiuni speciale..."
                  rows={3}
                  style={{ ...inputStyle, padding: '8px', resize: 'vertical', fontSize: '11px' }} 
                />
                )}
              </div>

              {/* Cutouts Section */}
              <div data-tutorial="cutouts-section" style={{ marginBottom: collapsedSections.cutouts ? '10px' : '16px', padding: collapsedSections.cutouts ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div onClick={() => setCollapsedSections(s => ({ ...s, cutouts: !s.cutouts }))} style={{ fontSize: '10px', color: '#c9a962', padding: collapsedSections.cutouts ? '6px 12px' : '0', marginBottom: collapsedSections.cutouts ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                  <span>✂️ DECUPAJE {selected.cutouts?.length > 0 ? `(${selected.cutouts.length})` : ''}</span>
                  <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.cutouts ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                </div>
                {!collapsedSections.cutouts && (<>
                
                {/* Add Cutout Dropdown */}
                <div style={{ marginBottom: '12px' }}>
                  <select
                    value=""
                    onChange={e => {
                      if (!e.target.value) return;
                      const pieceDepth = selected.type === 'backsplash' ? selected.height : selected.depth;
                      const newCutout = createCutoutFromPreset(e.target.value, selected.length, pieceDepth);
                      if (newCutout) {
                        const currentCutouts = selected.cutouts || [];
                        if (currentCutouts.length >= 6) {
                          alert('⚠️ Atenție: Piesa are deja 6 decupaje. Mai multe decupaje pot compromite integritatea structurală.');
                        }
                        updateElement(selected.id, { cutouts: [...currentCutouts, newCutout] });
                      }
                    }}
                    style={{ ...inputStyle, padding: '8px', width: '100%' }}
                  >
                    <option value="">+ Adaugă decupaj...</option>
                    {selected.type === 'island' && (
                      <optgroup label="🚰 Chiuvete">
                        <option value="sink-single">Chiuvetă simplă (50×40cm)</option>
                        <option value="sink-double">Chiuvetă dublă (80×45cm)</option>
                        <option value="sink-round">Chiuvetă rotundă (Ø44cm)</option>
                        <option value="tap-32">Baterie Ø32mm</option>
                      </optgroup>
                    )}
                    {selected.type === 'island' && (
                      <optgroup label="🔥 Plite">
                        <option value="hob-60">Plită 60cm (56×49cm)</option>
                        <option value="hob-70">Plită 70cm (65×49cm)</option>
                        <option value="hob-80">Plită 80cm (75×49cm)</option>
                        <option value="hob-90">Plită 90cm (85×49cm)</option>
                      </optgroup>
                    )}
                    <optgroup label="🔌 Prize">
                      <option value="outlet-single">Priză simplă (8×8cm)</option>
                      <option value="outlet-double">Priză dublă (15×8cm)</option>
                      <option value="outlet-triple">Priză triplă (22×8cm)</option>
                    </optgroup>
                    <optgroup label="⭕ Găuri">
                      <option value="hole-3">Gaură Ø3cm (cablu)</option>
                      <option value="hole-5">Gaură Ø5cm (racord)</option>
                      <option value="hole-8">Gaură Ø8cm (robinet)</option>
                    </optgroup>
                    <optgroup label="📐 Custom">
                      <option value="custom-rect">Dreptunghi custom</option>
                      <option value="custom-circle">Cerc custom</option>
                    </optgroup>
                  </select>
                </div>

                {/* Cutouts List */}
                {(selected.cutouts || []).length === 0 ? (
                  <div style={{ fontSize: '11px', color: '#555', textAlign: 'center', padding: '10px' }}>
                    Niciun decupaj adăugat
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Reverse order to show newest first, but keep original indices for updates */}
                    {[...(selected.cutouts || [])].map((cutout, idx) => ({ cutout, originalIndex: idx })).reverse().map(({ cutout, originalIndex }) => {
                      const cutoutIndex = originalIndex; // Use original index for updates
                      const pieceDepth = selected.type === 'backsplash' ? selected.height : selected.depth;
                      const userInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                      const validation = validateCutout(cutout, selected.length, pieceDepth, selected.cutouts || []);
                      const preset = CUTOUT_PRESETS[cutout.preset];
                      const icon = preset?.icon || (cutout.type === 'circle' ? '⭕' : '⬜');
                      
                      // Get element index for numbering (e.g., 1.01, 2.03)
                      const elementIndex = elements.findIndex(e => e.id === selected.id) + 1;
                      const cutoutNumber = `${elementIndex}.${String(originalIndex + 1).padStart(2, '0')}`;
                      const isCutoutSelected = selectedCutoutId === cutout.id;
                      const isEditingName = editingCutoutNameId === cutout.id;
                      
                      return (
                        <div 
                          key={cutout.id} 
                          onClick={() => { setSelectedCutoutId(cutout.id); setSelectedInductionId(null); }}
                          style={{
                            padding: '10px',
                            background: isCutoutSelected ? 'rgba(0, 200, 255, 0.1)' : '#1a1a1a',
                            borderRadius: '4px',
                            border: isCutoutSelected 
                              ? '2px solid #00c8ff' 
                              : `1px solid ${validation.errors.length > 0 ? '#c96262' : (validation.warnings.length > 0 ? '#c9a962' : '#2a2a2a')}`,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                              <span style={{ color: '#c9a962' }}>{cutoutNumber}</span>
                              <span>{icon}</span>
                              {isEditingName ? (
                                <input
                                  type="text"
                                  value={cutout.name}
                                  onChange={(e) => {
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, name: e.target.value };
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  onBlur={() => setEditingCutoutNameId(null)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') setEditingCutoutNameId(null); }}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                  style={{
                                    background: '#222',
                                    border: '1px solid #c9a962',
                                    borderRadius: '3px',
                                    color: '#ddd',
                                    fontSize: '11px',
                                    fontWeight: 500,
                                    padding: '2px 6px',
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                />
                              ) : (
                                <>
                                  <span style={{ color: '#ddd', flex: 1 }}>{cutout.name}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingCutoutNameId(cutout.id); }}
                                    style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px', padding: '0 4px' }}
                                    title="Redenumește"
                                  >✏️</button>
                                </>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Ștergi decupajul "${cutout.name}"?`)) {
                                  const newCutouts = (selected.cutouts || []).filter(c => c.id !== cutout.id);
                                  updateElement(selected.id, { cutouts: newCutouts });
                                }
                              }}
                              style={{ background: 'none', border: '1px solid rgba(201,98,98,0.3)', color: '#c96262', cursor: 'pointer', fontSize: '9px', padding: '2px 6px', borderRadius: '3px' }}
                            >Șterge</button>
                          </div>

                          {/* Dimensions */}
                          {cutout.type === 'circle' ? (
                            <div style={{ marginBottom: '8px' }}>
                              <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Diametru (cm)</label>
                              <NumericInput
                                value={(cutout.radius || 0) * 2}
                                onChange={v => {
                                  const newCutouts = [...(selected.cutouts || [])];
                                  newCutouts[cutoutIndex] = { ...cutout, radius: v / 2 };
                                  updateElement(selected.id, { cutouts: newCutouts });
                                }}
                                min={1}
                                max={160}
                                step={0.5}
                                style={{ ...inputStyle, padding: '6px', fontSize: '11px', width: '80px' }}
                              />
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'flex-end' }}>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '8px', color: '#666', display: 'block', marginBottom: '2px' }}>Lățime</label>
                                <NumericInput
                                  value={cutout.width || 0}
                                  onChange={v => {
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, width: v };
                                    const oldUserInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                                    const newCenter = cutoutUserInputToCenter(oldUserInput.cotaStanga, oldUserInput.cotaFata, { ...cutout, width: v }, selected.length, pieceDepth);
                                    newCutouts[cutoutIndex].center = newCenter;
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={1}
                                  max={320}
                                  step={1}
                                  style={{ ...inputStyle, padding: '4px 6px', fontSize: '11px' }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '8px', color: '#666', display: 'block', marginBottom: '2px' }}>Lungime</label>
                                <NumericInput
                                  value={cutout.height || 0}
                                  onChange={v => {
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, height: v };
                                    const oldUserInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                                    const newCenter = cutoutUserInputToCenter(oldUserInput.cotaStanga, oldUserInput.cotaFata, { ...cutout, height: v }, selected.length, pieceDepth);
                                    newCutouts[cutoutIndex].center = newCenter;
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={1}
                                  max={160}
                                  step={1}
                                  style={{ ...inputStyle, padding: '4px 6px', fontSize: '11px' }}
                                />
                              </div>
                              {cutout.type === 'rectangle' && (
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: '8px', color: '#666', display: 'block', marginBottom: '2px' }}>Rază colț</label>
                                  <NumericInput
                                    value={cutout.cornerRadius || 0}
                                    onChange={v => {
                                      const newCutouts = [...(selected.cutouts || [])];
                                      newCutouts[cutoutIndex] = { ...cutout, cornerRadius: v };
                                      updateElement(selected.id, { cutouts: newCutouts });
                                    }}
                                    min={0}
                                    max={Math.min(30, (cutout.width || 0) / 2, (cutout.height || 0) / 2)}
                                    step={0.5}
                                    style={{ ...inputStyle, padding: '4px 6px', fontSize: '11px' }}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Position - User friendly (from left edge) */}
                          <div style={{ marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                              <div>
                                <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>De la stânga (cm)</label>
                                <NumericInput
                                  value={Math.round(userInput.cotaStanga * 10) / 10}
                                  onChange={v => {
                                    const newCenter = cutoutUserInputToCenter(v, userInput.cotaFata, cutout, selected.length, pieceDepth);
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, center: newCenter };
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={0}
                                  max={selected.length}
                                  step={1}
                                  style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>De la față (cm)</label>
                                <NumericInput
                                  value={Math.round(userInput.cotaFata * 10) / 10}
                                  onChange={v => {
                                    const newCenter = cutoutUserInputToCenter(userInput.cotaStanga, v, cutout, selected.length, pieceDepth);
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, center: newCenter };
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={0}
                                  max={pieceDepth}
                                  step={1}
                                  style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Edge distances display */}
                          <div style={{ fontSize: '9px', color: '#666', padding: '6px', background: '#111', borderRadius: '3px', marginBottom: validation.errors.length > 0 || validation.warnings.length > 0 ? '8px' : 0 }}>
                            📏 Distanțe margini: 
                            <span style={{ color: validation.edges.stanga < 5 ? '#c96262' : '#888' }}> St:{validation.edges.stanga.toFixed(1)}</span> |
                            <span style={{ color: validation.edges.dreapta < 5 ? '#c96262' : '#888' }}> Dr:{validation.edges.dreapta.toFixed(1)}</span> |
                            <span style={{ color: validation.edges.fata < 5 ? '#c96262' : '#888' }}> Față:{validation.edges.fata.toFixed(1)}</span> |
                            <span style={{ color: validation.edges.spate < 5 ? '#c96262' : '#888' }}> Spate:{validation.edges.spate.toFixed(1)}</span>
                          </div>

                          {/* Errors */}
                          {validation.errors.length > 0 && (
                            <div style={{ fontSize: '10px', color: '#c96262', padding: '6px', background: 'rgba(201,98,98,0.1)', borderRadius: '3px', marginBottom: validation.warnings.length > 0 ? '4px' : 0 }}>
                              ⛔ {validation.errors.join('; ')}
                            </div>
                          )}

                          {/* Warnings */}
                          {validation.warnings.length > 0 && (
                            <div style={{ fontSize: '10px', color: '#c9a962', padding: '6px', background: 'rgba(201,169,98,0.1)', borderRadius: '3px' }}>
                              ⚠️ {validation.warnings.join('; ')}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Cutouts limit warning */}
                {(selected.cutouts || []).length >= 6 && (
                  <div style={{ fontSize: '10px', color: '#c96262', padding: '8px', background: 'rgba(201,98,98,0.1)', borderRadius: '4px', marginTop: '8px', textAlign: 'center' }}>
                    ⚠️ Limită de 6 decupaje atinsă - risc de pierdere integritate structurală
                  </div>
                )}
                </>)}
              </div>

              {/* Induction Systems Section - only for island (blat) with ceramic material */}
              {selected.type === 'island' && (() => {
                const isCeramic = (() => {
                  const color = library.colors.find(c => c.id === selected.material);
                  const mfr = library.manufacturers.find(m => m.id === color?.manufacturer);
                  return mfr?.materialType === 'ceramic';
                })();
                return (
              <div style={{ marginBottom: collapsedSections.induction ? '10px' : '16px', padding: collapsedSections.induction ? '0' : '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div onClick={() => setCollapsedSections(s => ({ ...s, induction: !s.induction }))} style={{ fontSize: '10px', color: isCeramic ? '#c9a962' : '#555', padding: collapsedSections.induction ? '6px 12px' : '0', marginBottom: collapsedSections.induction ? '0' : '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                  <span>⚡ SISTEME INDUCTIE {selected.inductionSystems?.length > 0 ? `(${selected.inductionSystems.length})` : ''}</span>
                  <span style={{ fontSize: '8px', color: '#555', transition: 'transform 0.2s', transform: collapsedSections.induction ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                </div>
                {!collapsedSections.induction && (<>
                {!isCeramic ? (
                  <div style={{ fontSize: '10px', color: '#888', padding: '12px', textAlign: 'center', background: '#1a1a1a', borderRadius: '4px' }}>
                    Sistemele de inductie wireless sunt disponibile doar pentru materiale de tip <strong style={{ color: '#c9a962' }}>Ceramică</strong>.
                  </div>
                ) : (<>
                {/* Add Induction Dropdown */}
                <div style={{ marginBottom: '12px' }}>
                  <select
                    value=""
                    onChange={e => {
                      if (!e.target.value) return;
                      const preset = (library.inductionSystems || []).find(s => s.id === e.target.value);
                      if (!preset) return;
                      if ((selected.inductionSystems || []).length >= 3) return;
                      const newSystem = {
                        id: Math.random().toString(36).substr(2, 9),
                        presetId: preset.id,
                        name: preset.name,
                        type: preset.type,
                        width: preset.width || null,
                        height: preset.height || null,
                        radius: preset.radius || null,
                        depth: preset.depth,
                        centerX: 0,
                        centerZ: 0,
                      };
                      updateElement(selected.id, { inductionSystems: [...(selected.inductionSystems || []), newSystem] });
                    }}
                    disabled={(selected.inductionSystems || []).length >= 3}
                    style={{ ...inputStyle, padding: '8px', width: '100%', cursor: (selected.inductionSystems || []).length >= 3 ? 'not-allowed' : 'pointer' }}
                  >
                    <option value="">{(selected.inductionSystems || []).length >= 3 ? 'Limită atinsă (max 3)' : '+ Adaugă sistem inductie...'}</option>
                    {(library.inductionSystems || []).map(sys => (
                      <option key={sys.id} value={sys.id}>
                        {sys.icon} {sys.name} ({sys.type === 'circle' ? `Ø${(sys.radius || 0) * 2}cm` : `${sys.width}×${sys.height}cm`})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Induction Systems List */}
                {(selected.inductionSystems || []).map((sys, idx) => {
                  const preset = (library.inductionSystems || []).find(s => s.id === sys.presetId);
                  const pieceLength = selected.length;
                  const pieceDepth = selected.depth;
                  const sysWidth = sys.type === 'circle' ? (sys.radius || 0) * 2 : (sys.width || 0);
                  const sysDepth = sys.type === 'circle' ? (sys.radius || 0) * 2 : (sys.height || 0);
                  const minFront = preset?.minFront || 3;
                  const minBack = preset?.minBack || 3;
                  const cotaStanga = (pieceLength / 2) + (sys.centerX || 0) - sysWidth / 2;
                  const cotaFata = (pieceDepth / 2) + (sys.centerZ || 0) - sysDepth / 2;
                  
                  return (
                    <div key={sys.id} 
                      onClick={() => { setSelectedInductionId(selectedInductionId === sys.id ? null : sys.id); setSelectedCutoutId(null); }}
                      style={{ marginBottom: '8px', padding: '10px', background: selectedInductionId === sys.id ? 'rgba(201,122,50,0.15)' : '#1a1a1a', borderRadius: '6px', border: `1px solid ${selectedInductionId === sys.id ? '#c97a32' : '#2a2a2a'}`, cursor: 'pointer', transition: 'all 0.15s' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 500, color: selectedInductionId === sys.id ? '#c97a32' : '#ccc' }}>{preset?.icon || '⚡'} {sys.name}</span>
                        <button onClick={() => {
                          const updated = [...(selected.inductionSystems || [])];
                          updated.splice(idx, 1);
                          updateElement(selected.id, { inductionSystems: updated });
                        }} style={{ background: 'none', border: 'none', color: '#c96262', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
                      </div>
                      <div style={{ fontSize: '9px', color: '#666', marginBottom: '6px' }}>
                        {sys.type === 'circle' ? `Ø${(sys.radius || 0) * 2}cm` : `${sys.width}×${sys.height}cm`}
                        {' · '}{sys.depth}mm sub blat
                        {' · min față '}{minFront}cm / spate {minBack}cm
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <div>
                          <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Cota stânga (cm)</label>
                          <NumericInput
                            value={Math.round(cotaStanga * 10) / 10}
                            onChange={v => {
                              const newCenterX = v + sysWidth / 2 - pieceLength / 2;
                              const clampedX = Math.max(-pieceLength / 2 + sysWidth / 2, Math.min(pieceLength / 2 - sysWidth / 2, newCenterX));
                              const updated = [...(selected.inductionSystems || [])];
                              updated[idx] = { ...sys, centerX: clampedX };
                              updateElement(selected.id, { inductionSystems: updated });
                            }}
                            min={0}
                            max={pieceLength - sysWidth}
                            step={0.5}
                            style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Cota față (cm)</label>
                          <NumericInput
                            value={Math.round(cotaFata * 10) / 10}
                            onChange={v => {
                              const newCenterZ = v + sysDepth / 2 - pieceDepth / 2;
                              const minZ = -pieceDepth / 2 + sysDepth / 2 + minFront;
                              const maxZ = pieceDepth / 2 - sysDepth / 2 - minBack;
                              const clampedZ = Math.max(minZ, Math.min(maxZ, newCenterZ));
                              const updated = [...(selected.inductionSystems || [])];
                              updated[idx] = { ...sys, centerZ: clampedZ };
                              updateElement(selected.id, { inductionSystems: updated });
                            }}
                            min={minFront}
                            max={pieceDepth - sysDepth - minBack}
                            step={0.5}
                            style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                          />
                        </div>
                      </div>
                      {(() => {
                        const validation = validateInduction(sys, pieceLength, pieceDepth, selected.inductionSystems || [], selected.cutouts || [], preset);
                        if (validation.errors.length === 0 && validation.warnings.length === 0) return null;
                        return (
                          <div style={{ marginTop: '6px' }}>
                            {validation.errors.map((err, i) => (
                              <div key={`e${i}`} style={{ fontSize: '9px', color: '#c96262', padding: '3px 6px', background: 'rgba(201,98,98,0.1)', borderRadius: '3px', marginBottom: '2px' }}>⛔ {err}</div>
                            ))}
                            {validation.warnings.map((w, i) => (
                              <div key={`w${i}`} style={{ fontSize: '9px', color: '#c9a962', padding: '3px 6px', background: 'rgba(201,169,98,0.1)', borderRadius: '3px', marginBottom: '2px' }}>⚠️ {w}</div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                </>)}
                </>)}
              </div>
              );
              })()}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
                <button onClick={() => duplicateElement(selected.id)} style={{ ...secondaryBtnStyle, flex: 1, padding: '10px', fontSize: '11px' }}>📋 Duplică</button>
                <button onClick={() => removeElement(selected.id)} style={{ ...secondaryBtnStyle, flex: 1, padding: '10px', fontSize: '11px', color: '#c96262' }}>🗑️ Șterge</button>
              </div>
            </div>
            )
          ) : (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#555', fontSize: '12px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>👆</div>
              Selectează un element pentru a vedea proprietățile
            </div>
          )}
        </div>
      </div>
      
      {/* Texture Preview Popup */}
      {texturePreview && (
        <div 
          onClick={() => {
            // Trigger fade out, apoi elimină componenta
            setTexturePreviewVisible(false);
            setTimeout(() => setTexturePreview(null), 250);
          }}
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.9)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 1100,
            cursor: 'pointer',
            opacity: texturePreviewVisible ? 1 : 0,
            transition: 'opacity 0.25s ease-out',
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              transform: texturePreviewVisible ? 'scale(1)' : 'scale(0.95)',
              opacity: texturePreviewVisible ? 1 : 0,
              transition: 'transform 0.25s ease-out, opacity 0.25s ease-out',
            }}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setTexturePreviewVisible(false);
                setTimeout(() => setTexturePreview(null), 250);
              }}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              title="Închide"
            >×</button>
            
            {/* Texture name */}
            <div style={{ 
              color: '#c9a962', 
              fontSize: '18px', 
              fontWeight: 500,
              textAlign: 'center',
            }}>
              {texturePreview.name}
            </div>
            
            {/* Texture image */}
            <img 
              src={texturePreview.texture} 
              alt={texturePreview.name}
              style={{ 
                maxWidth: '90vw',
                maxHeight: 'calc(90vh - 80px)',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            />
            
            {/* Hint */}
            <div style={{ 
              color: '#666', 
              fontSize: '12px',
            }}>
              Click în afara imaginii pentru a închide
            </div>
          </div>
        </div>
      )}
      
      {/* Footer - Bin Packing / Slab Calculator */}
      <div data-tutorial="footer">
      <SlabCalculatorFooter 
        elements={elements} 
        library={library} 
        selectedIds={selectedIds}
        handleElementSelect={handleElementSelect}
        project={project}
        user={user}
        supabase={supabase}
        canvasRef={canvasRef}
        manualLayoutPositions={manualLayoutPositions}
        setManualLayoutPositions={setManualLayoutPositions}
        pushManualLayoutToHistory={pushManualLayoutToHistory}
        selectedCutoutId={selectedCutoutId}
        setSelectedCutoutId={setSelectedCutoutId}
        selectedInductionId={selectedInductionId}
        setSelectedInductionId={setSelectedInductionId}
        exportGLB={exportGLB}
      />
      </div>

      {/* Tutorial Overlay */}
      {tutorialStep !== null && <TutorialOverlay 
        step={tutorialStep} 
        actions={tutorialActions} 
        onClose={closeTutorial} 
        onAdvance={advanceTutorial}
        onBack={goBackTutorial}
      />}
    </div>
  );
}

// ============================================
// SLAB CALCULATOR FOOTER COMPONENT
// ============================================

function SlabCalculatorFooter({ elements, library, selectedIds, handleElementSelect, project, user, supabase, canvasRef, manualLayoutPositions, setManualLayoutPositions, pushManualLayoutToHistory, selectedCutoutId, setSelectedCutoutId, selectedInductionId, setSelectedInductionId, exportGLB }) {
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState(null); // 'success' | 'error' | null
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [tempPhone, setTempPhone] = useState(''); // Phone input for users without phone in profile
  const [footerZoom, setFooterZoom] = useState(false); // Footer zoom x2
  
  // Drag state (local - only for visual feedback during drag)
  const [draggingPiece, setDraggingPiece] = useState(null); // { piece, startX, startY, originalX, originalY, tileIdx }
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); // Current drag offset in pixels
  const [pendingDrag, setPendingDrag] = useState(null); // For delay before drag starts
  const [snapIndicators, setSnapIndicators] = useState([]); // [{ tileIdx, x, y, type: 'horizontal'|'vertical' }]
  const dragTimerRef = useRef(null);
  const tileRefsMap = useRef({}); // Map of tileIdx -> DOM element for drop detection
  
  // Use props for manual positions (shared with 3D)
  const manualPositions = manualLayoutPositions;
  const setManualPositions = setManualLayoutPositions;
  
  const footerRef = useRef(null);
  const tilesAreaRef = useRef(null);
  
  // For backward compat
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  
  const getColorById = (id) => library?.colors?.find(c => c.id === id) || { name: 'N/A', color: '#666' };
  
  const getMaterialType = (colorId) => {
    const color = library?.colors?.find(c => c.id === colorId);
    if (!color) return '';
    const manufacturer = library?.manufacturers?.find(m => m.id === color.manufacturer);
    return manufacturer?.materialType || '';
  };
  
  const getFormatById = (formatId) => library?.formats?.find(f => f.id === formatId);
  
  // Use the shared computeLayout function - SINGLE SOURCE OF TRUTH
  // Guard inside useMemo to maintain hooks order
  const { pieces: rawPieces, tiles } = useMemo(() => {
    if (!library || !library.colors || library.colors.length === 0) {
      return { pieces: [], tiles: [], piecesByKey: {} };
    }
    return computeLayout(elements, library, manualPositions);
  }, [elements, library, manualPositions]);
  
  // Add sequential numbering to pieces (01, 02, 03, ...)
  const pieces = rawPieces.map((p, idx) => ({
    ...p,
    pieceNumber: String(idx + 1).padStart(2, '0'),
  }));
  
  // Calculate uniform scale for drag calculations
  const maxTileWidth = tiles.length > 0 ? Math.max(...tiles.map(t => t.format?.width || 160)) : 160;
  const baseScale = 100 / maxTileWidth;
  const uniformScale = baseScale * (footerZoom ? 2 : 1);
  
  // Add isManual flag for visual indicator (dashed border)
  // pieces already have correct positions from computeLayout
  const piecesWithManualPositions = useMemo(() => pieces.map(p => {
    const pieceKey = `${p.elementId}_${p.key}`;
    const manual = manualPositions[pieceKey];
    if (manual?.isManual) {
      return { ...p, isManual: true };
    }
    return p;
  }), [pieces, manualPositions]);
  
  // Check collision between two rectangles
  const checkCollision = (rect1, rect2) => {
    return !(rect1.x + rect1.w <= rect2.x || 
             rect2.x + rect2.w <= rect1.x || 
             rect1.y + rect1.h <= rect2.y || 
             rect2.y + rect2.h <= rect1.y);
  };
  
  // Drag handlers
  const handleMouseDown = (e, piece, tileIdx) => {
    e.preventDefault();
    
    // Store pending drag info
    const pending = {
      piece,
      tileIdx,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      originalX: piece.x,
      originalY: piece.y,
    };
    setPendingDrag(pending);
    
    // Start timer - drag begins after 150ms hold
    dragTimerRef.current = setTimeout(() => {
      // Save current state to undo history before starting drag
      if (pushManualLayoutToHistory) {
        pushManualLayoutToHistory();
      }
      setDraggingPiece(pending);
      setDragOffset({ x: 0, y: 0 });
      setPendingDrag(null);
    }, 150);
  };
  
  const handleMouseUp = (e, piece) => {
    // If timer hasn't fired yet, this is a click (select)
    if (pendingDrag && !draggingPiece) {
      clearTimeout(dragTimerRef.current);
      setPendingDrag(null);
      handleElementSelect(piece.elementId, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
  };
  
  const handleDragMove = useCallback((e) => {
    if (!draggingPiece) return;
    
    const dx = e.clientX - draggingPiece.startMouseX;
    const dy = e.clientY - draggingPiece.startMouseY;
    setDragOffset({ x: dx, y: dy });
    
    // Calculate snap indicators
    const { piece, tileIdx: originalTileIdx } = draggingPiece;
    const originalTile = tiles[originalTileIdx];
    const snapThreshold = 15; // cm - increased for better UX
    
    // Detect which tile the mouse is currently over
    let targetTileIdx = originalTileIdx;
    let targetTile = originalTile;
    
    for (const [idxStr, tileEl] of Object.entries(tileRefsMap.current)) {
      if (!tileEl) continue;
      const rect = tileEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const idx = parseInt(idxStr);
        const potentialTile = tiles[idx];
        // Check if tile is compatible (same colorId and thickness)
        if (potentialTile && 
            potentialTile.colorId === originalTile.colorId && 
            potentialTile.thickness === originalTile.thickness) {
          targetTileIdx = idx;
          targetTile = potentialTile;
        }
        break;
      }
    }
    
    const format = targetTile?.format || { length: 320, width: 160 };
    
    // Calculate current position relative to target tile
    let currentX, currentY;
    
    if (targetTileIdx === originalTileIdx) {
      // Same tile - use drag offset
      currentX = draggingPiece.originalX + dx / uniformScale;
      currentY = draggingPiece.originalY + dy / uniformScale;
    } else {
      // Different tile - calculate position relative to target tile
      const targetEl = tileRefsMap.current[targetTileIdx];
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        currentX = (e.clientX - rect.left) / uniformScale - piece.pieceW / 2;
        currentY = (e.clientY - rect.top) / uniformScale - piece.pieceH / 2;
      } else {
        currentX = 0;
        currentY = 0;
      }
    }
    
    // Get other pieces on TARGET tile (not original)
    const otherPieces = piecesWithManualPositions.filter(p => 
      p.tileIndex === targetTileIdx && 
      !(p.elementId === piece.elementId && p.key === piece.key)
    );
    
    const indicators = [];
    
    // Check snap to other pieces on target tile
    otherPieces.forEach(other => {
      // Right edge of dragged -> Left edge of other
      if (Math.abs(currentX + piece.pieceW - other.x) < snapThreshold) {
        indicators.push({ tileIdx: targetTileIdx, x: other.x, y1: Math.min(currentY, other.y), y2: Math.max(currentY + piece.pieceH, other.y + other.pieceH), type: 'vertical' });
      }
      // Left edge of dragged -> Right edge of other
      if (Math.abs(currentX - (other.x + other.pieceW)) < snapThreshold) {
        indicators.push({ tileIdx: targetTileIdx, x: other.x + other.pieceW, y1: Math.min(currentY, other.y), y2: Math.max(currentY + piece.pieceH, other.y + other.pieceH), type: 'vertical' });
      }
      // Bottom edge of dragged -> Top edge of other
      if (Math.abs(currentY + piece.pieceH - other.y) < snapThreshold) {
        indicators.push({ tileIdx: targetTileIdx, y: other.y, x1: Math.min(currentX, other.x), x2: Math.max(currentX + piece.pieceW, other.x + other.pieceW), type: 'horizontal' });
      }
      // Top edge of dragged -> Bottom edge of other
      if (Math.abs(currentY - (other.y + other.pieceH)) < snapThreshold) {
        indicators.push({ tileIdx: targetTileIdx, y: other.y + other.pieceH, x1: Math.min(currentX, other.x), x2: Math.max(currentX + piece.pieceW, other.x + other.pieceW), type: 'horizontal' });
      }
    });
    
    // Check snap to target tile edges
    if (Math.abs(currentX) < snapThreshold) {
      indicators.push({ tileIdx: targetTileIdx, x: 0, y1: 0, y2: format.width, type: 'vertical' });
    }
    if (Math.abs(currentY) < snapThreshold) {
      indicators.push({ tileIdx: targetTileIdx, y: 0, x1: 0, x2: format.length, type: 'horizontal' });
    }
    if (Math.abs(currentX + piece.pieceW - format.length) < snapThreshold) {
      indicators.push({ tileIdx: targetTileIdx, x: format.length, y1: 0, y2: format.width, type: 'vertical' });
    }
    if (Math.abs(currentY + piece.pieceH - format.width) < snapThreshold) {
      indicators.push({ tileIdx: targetTileIdx, y: format.width, x1: 0, x2: format.length, type: 'horizontal' });
    }
    
    // If no piece snap found on current tile, check neighbor tiles for alignment guides
    const hasPieceSnap = indicators.some(ind => ind.type === 'horizontal' && ind.y !== 0 && ind.y !== format.width);
    
    if (!hasPieceSnap) {
      // Find compatible neighbor tiles (same colorId and thickness)
      const compatibleTiles = tiles
        .map((t, idx) => ({ ...t, idx }))
        .filter(t => t.colorId === targetTile.colorId && t.thickness === targetTile.thickness && t.idx !== targetTileIdx);
      
      // Check pieces on neighbor tiles for Y alignment (horizontal guides)
      compatibleTiles.forEach(neighborTile => {
        const neighborPieces = piecesWithManualPositions.filter(p => p.tileIndex === neighborTile.idx);
        
        neighborPieces.forEach(other => {
          // Align top edge with neighbor piece top
          if (Math.abs(currentY - other.y) < snapThreshold) {
            indicators.push({ 
              tileIdx: targetTileIdx, 
              y: other.y, 
              x1: 0, 
              x2: format.length, 
              type: 'horizontal',
              isNeighbor: true // Mark as neighbor reference
            });
            // Also show on neighbor tile
            indicators.push({ 
              tileIdx: neighborTile.idx, 
              y: other.y, 
              x1: 0, 
              x2: neighborTile.format?.length || 320, 
              type: 'horizontal',
              isNeighbor: true
            });
          }
          // Align bottom edge with neighbor piece bottom
          if (Math.abs(currentY + piece.pieceH - (other.y + other.pieceH)) < snapThreshold) {
            indicators.push({ 
              tileIdx: targetTileIdx, 
              y: other.y + other.pieceH - piece.pieceH + piece.pieceH, // bottom edge Y
              x1: 0, 
              x2: format.length, 
              type: 'horizontal',
              isNeighbor: true
            });
            indicators.push({ 
              tileIdx: neighborTile.idx, 
              y: other.y + other.pieceH, 
              x1: 0, 
              x2: neighborTile.format?.length || 320, 
              type: 'horizontal',
              isNeighbor: true
            });
          }
          // Align top edge with neighbor piece bottom
          if (Math.abs(currentY - (other.y + other.pieceH)) < snapThreshold) {
            indicators.push({ 
              tileIdx: targetTileIdx, 
              y: other.y + other.pieceH, 
              x1: 0, 
              x2: format.length, 
              type: 'horizontal',
              isNeighbor: true
            });
            indicators.push({ 
              tileIdx: neighborTile.idx, 
              y: other.y + other.pieceH, 
              x1: 0, 
              x2: neighborTile.format?.length || 320, 
              type: 'horizontal',
              isNeighbor: true
            });
          }
        });
      });
    }
    
    setSnapIndicators(indicators);
  }, [draggingPiece, tiles, uniformScale, piecesWithManualPositions]);
  
  const handleDragEnd = useCallback((e) => {
    // Clear any pending timer
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
    }
    setPendingDrag(null);
    
    if (!draggingPiece) return;
    
    const { piece, tileIdx: originalTileIdx } = draggingPiece;
    const originalTile = tiles[originalTileIdx];
    
    // Detect which tile the mouse is over
    let targetTileIdx = originalTileIdx;
    let targetTile = originalTile;
    
    // Check all tiles to find which one the mouse is over
    for (const [idxStr, tileEl] of Object.entries(tileRefsMap.current)) {
      if (!tileEl) continue;
      const rect = tileEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const idx = parseInt(idxStr);
        const potentialTile = tiles[idx];
        // Check if tile is compatible (same colorId and thickness)
        if (potentialTile && 
            potentialTile.colorId === originalTile.colorId && 
            potentialTile.thickness === originalTile.thickness) {
          targetTileIdx = idx;
          targetTile = potentialTile;
        }
        break;
      }
    }
    
    const format = targetTile?.format || { length: 320, width: 160 };
    
    // Calculate new position in cm
    // If dropped on same tile, use drag offset
    // If dropped on different tile, calculate position relative to new tile
    let newX, newY;
    
    if (targetTileIdx === originalTileIdx) {
      const dx = dragOffset.x / uniformScale;
      const dy = dragOffset.y / uniformScale;
      newX = draggingPiece.originalX + dx;
      newY = draggingPiece.originalY + dy;
    } else {
      // Dropped on different tile - calculate position relative to target tile
      const targetEl = tileRefsMap.current[targetTileIdx];
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        newX = (e.clientX - rect.left) / uniformScale - piece.pieceW / 2;
        newY = (e.clientY - rect.top) / uniformScale - piece.pieceH / 2;
      } else {
        newX = 0;
        newY = 0;
      }
    }
    
    // Snap threshold in cm (increased for better UX)
    const snapThreshold = 15;
    
    // Get other pieces on target tile (with their current positions)
    const otherPieces = piecesWithManualPositions.filter(p => 
      p.tileIndex === targetTileIdx && 
      !(p.elementId === piece.elementId && p.key === piece.key)
    );
    
    // Helper function to check if a position is valid (no collision, within bounds)
    const isValidPosition = (x, y) => {
      if (x < 0 || y < 0 || x + piece.pieceW > format.length || y + piece.pieceH > format.width) {
        return false;
      }
      const testRect = { x, y, w: piece.pieceW, h: piece.pieceH };
      for (const other of otherPieces) {
        const otherRect = { x: other.x, y: other.y, w: other.pieceW, h: other.pieceH };
        if (checkCollision(testRect, otherRect)) {
          return false;
        }
      }
      return true;
    };
    
    // Helper function to find best snap position
    const findBestPosition = (proposedX, proposedY) => {
      // Clamp proposed position to bounds first
      let clampedX = Math.max(0, Math.min(proposedX, format.length - piece.pieceW));
      let clampedY = Math.max(0, Math.min(proposedY, format.width - piece.pieceH));
      
      // 1. Try snapping to edges and pieces
      let snappedX = clampedX;
      let snappedY = clampedY;
      
      // Snap to tile edges
      if (Math.abs(snappedX) < snapThreshold) snappedX = 0;
      if (Math.abs(snappedY) < snapThreshold) snappedY = 0;
      if (Math.abs(snappedX + piece.pieceW - format.length) < snapThreshold) snappedX = format.length - piece.pieceW;
      if (Math.abs(snappedY + piece.pieceH - format.width) < snapThreshold) snappedY = format.width - piece.pieceH;
      
      // Snap to other pieces
      otherPieces.forEach(other => {
        // Snap right edge of dragged piece to left edge of other
        if (Math.abs(snappedX + piece.pieceW - other.x) < snapThreshold) snappedX = other.x - piece.pieceW;
        // Snap left edge of dragged piece to right edge of other
        if (Math.abs(snappedX - (other.x + other.pieceW)) < snapThreshold) snappedX = other.x + other.pieceW;
        // Snap bottom edge of dragged piece to top edge of other
        if (Math.abs(snappedY + piece.pieceH - other.y) < snapThreshold) snappedY = other.y - piece.pieceH;
        // Snap top edge of dragged piece to bottom edge of other
        if (Math.abs(snappedY - (other.y + other.pieceH)) < snapThreshold) snappedY = other.y + other.pieceH;
      });
      
      // Clamp snapped position to bounds
      snappedX = Math.max(0, Math.min(snappedX, format.length - piece.pieceW));
      snappedY = Math.max(0, Math.min(snappedY, format.width - piece.pieceH));
      
      // Round to nearest cm
      snappedX = Math.round(snappedX);
      snappedY = Math.round(snappedY);
      
      // If snapped position is valid, use it
      if (isValidPosition(snappedX, snappedY)) {
        return { x: snappedX, y: snappedY };
      }
      
      // 2. Fallback: scan from top-left
      for (let y = 0; y <= format.width - piece.pieceH; y += 5) {
        for (let x = 0; x <= format.length - piece.pieceW; x += 5) {
          if (isValidPosition(x, y)) {
            return { x, y };
          }
        }
      }
      
      return null; // No valid position found
    };
    
    // Find best position
    const bestPosition = findBestPosition(newX, newY);
    
    if (!bestPosition) {
      // No valid position found - revert
      setDraggingPiece(null);
      setDragOffset({ x: 0, y: 0 });
      setSnapIndicators([]); // Clear snap indicators
      return;
    }
    
    newX = bestPosition.x;
    newY = bestPosition.y;
    
    // Save the new position with piece dimensions (to preserve rotation/grain)
    const pieceKey = `${piece.elementId}_${piece.key}`;
    setManualPositions(prev => ({
      ...prev,
      [pieceKey]: { 
        tileIndex: targetTileIdx, 
        x: newX, 
        y: newY, 
        pieceW: piece.pieceW,
        pieceH: piece.pieceH,
        rotated: piece.rotated,
        isManual: true 
      }
    }));
    
    setDraggingPiece(null);
    setDragOffset({ x: 0, y: 0 });
    setSnapIndicators([]); // Clear snap indicators
  }, [draggingPiece, dragOffset, uniformScale, tiles, piecesWithManualPositions, setManualPositions]);
  
  // Global mouse event listeners for drag
  useEffect(() => {
    if (draggingPiece) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [draggingPiece, handleDragMove, handleDragEnd]);
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current);
      }
    };
  }, []);
  
  // Calculate cutting lengths per tile
  // External cuts: optimized to not count shared edges twice
  // Internal cuts: perimeters of all cutouts
  // NOTE: Must be before early return to maintain hooks order
  const cuttingStats = useMemo(() => {
    if (tiles.length === 0) return { external: 0, internal: 0, cutoutCount: 0, cutoutArea: 0 };
    
    let totalExternalCuts = 0;
    let totalInternalCuts = 0;
    
    tiles.forEach((tile, tileIdx) => {
      const tilePieces = pieces.filter(p => p.tileIndex === tileIdx);
      if (tilePieces.length === 0) return;
      
      // Collect all edges as line segments
      // Each edge: { x1, y1, x2, y2, horizontal: bool }
      const edges = [];
      
      tilePieces.forEach(p => {
        const x1 = p.x, y1 = p.y;
        const x2 = p.x + p.pieceW, y2 = p.y + p.pieceH;
        
        // Four edges per piece
        edges.push({ x1, y1, x2: x2, y2: y1, horizontal: true });  // top
        edges.push({ x1, y1: y2, x2: x2, y2: y2, horizontal: true });  // bottom
        edges.push({ x1, y1, x2: x1, y2: y2, horizontal: false }); // left
        edges.push({ x1: x2, y1, x2: x2, y2: y2, horizontal: false }); // right
      });
      
      // Find unique cuts by merging overlapping/adjacent segments on same line
      // and removing segments that appear twice (shared edges)
      
      // Group edges by their axis position
      const horizontalLines = {}; // y -> array of {x1, x2}
      const verticalLines = {};   // x -> array of {y1, y2}
      
      edges.forEach(e => {
        if (e.horizontal) {
          const y = Math.round(e.y1 * 100) / 100; // round to avoid float issues
          if (!horizontalLines[y]) horizontalLines[y] = [];
          horizontalLines[y].push({ x1: Math.min(e.x1, e.x2), x2: Math.max(e.x1, e.x2) });
        } else {
          const x = Math.round(e.x1 * 100) / 100;
          if (!verticalLines[x]) verticalLines[x] = [];
          verticalLines[x].push({ y1: Math.min(e.y1, e.y2), y2: Math.max(e.y1, e.y2) });
        }
      });
      
      // For each line, merge overlapping segments and count unique length
      const mergeSegments = (segments) => {
        if (segments.length === 0) return 0;
        
        // Sort by start position
        const sorted = [...segments].sort((a, b) => (a.x1 ?? a.y1) - (b.x1 ?? b.y1));
        
        // Count occurrences of each segment to detect shared edges
        const segmentCounts = {};
        sorted.forEach(s => {
          const key = `${s.x1 ?? s.y1}-${s.x2 ?? s.y2}`;
          segmentCounts[key] = (segmentCounts[key] || 0) + 1;
        });
        
        // Filter out segments that appear twice (shared edges - no cut needed)
        const uniqueSegments = sorted.filter(s => {
          const key = `${s.x1 ?? s.y1}-${s.x2 ?? s.y2}`;
          return segmentCounts[key] === 1;
        });
        
        if (uniqueSegments.length === 0) return 0;
        
        // Merge overlapping/adjacent segments
        let totalLength = 0;
        let currentStart = uniqueSegments[0].x1 ?? uniqueSegments[0].y1;
        let currentEnd = uniqueSegments[0].x2 ?? uniqueSegments[0].y2;
        
        for (let i = 1; i < uniqueSegments.length; i++) {
          const segStart = uniqueSegments[i].x1 ?? uniqueSegments[i].y1;
          const segEnd = uniqueSegments[i].x2 ?? uniqueSegments[i].y2;
          
          if (segStart <= currentEnd) {
            // Overlapping or adjacent - extend current segment
            currentEnd = Math.max(currentEnd, segEnd);
          } else {
            // Gap - add current segment and start new one
            totalLength += currentEnd - currentStart;
            currentStart = segStart;
            currentEnd = segEnd;
          }
        }
        totalLength += currentEnd - currentStart;
        
        return totalLength;
      };
      
      // Sum up all unique horizontal cuts
      Object.values(horizontalLines).forEach(segments => {
        const segs = segments.map(s => ({ x1: s.x1, x2: s.x2 }));
        totalExternalCuts += mergeSegments(segs);
      });
      
      // Sum up all unique vertical cuts
      Object.values(verticalLines).forEach(segments => {
        const segs = segments.map(s => ({ y1: s.y1, y2: s.y2 }));
        totalExternalCuts += mergeSegments(segs);
      });
    });
    
    // Calculate internal cuts (cutout perimeters) and cutout stats
    let cutoutCount = 0;
    let cutoutArea = 0;
    
    elements.forEach(el => {
      if (!el.cutouts || el.cutouts.length === 0) return;
      
      el.cutouts.forEach(cutout => {
        cutoutCount++;
        if (cutout.type === 'circle') {
          // Circle perimeter = 2 * PI * r, area = PI * r^2
          const r = cutout.radius || 0;
          totalInternalCuts += 2 * Math.PI * r;
          cutoutArea += Math.PI * r * r;
        } else {
          // Rectangle perimeter = 2 * (w + h), area = w * h
          const w = cutout.width || 0;
          const h = cutout.height || 0;
          totalInternalCuts += 2 * (w + h);
          cutoutArea += w * h;
        }
      });
    });
    
    return {
      external: totalExternalCuts / 100, // convert cm to m
      internal: totalInternalCuts / 100, // convert cm to m
      cutoutCount,
      cutoutArea: cutoutArea / 10000 // convert cm² to m²
    };
  }, [tiles, pieces, elements]);
  
  // Calculate values (safe even with empty arrays)
  const totalArea = pieces.reduce((s, p) => s + p.w * p.h / 10000, 0);
  const exceedingPieces = pieces.filter(p => p.exceeds);
  
  // Check for cutout errors across all elements
  const cutoutErrors = [];
  elements.forEach(el => {
    if (el.cutouts && el.cutouts.length > 0) {
      const pieceDepth = el.type === 'backsplash' ? el.height : el.depth;
      el.cutouts.forEach(cutout => {
        const validation = validateCutout(cutout, el.length, pieceDepth, el.cutouts);
        if (!validation.valid) {
          cutoutErrors.push({ element: el.name, cutout: cutout.name, errors: validation.errors });
        }
      });
    }
  });
  const hasCutoutErrors = cutoutErrors.length > 0;

  // Check for induction system errors across all elements
  const inductionErrors = [];
  elements.forEach(el => {
    if (el.type === 'island' && el.inductionSystems && el.inductionSystems.length > 0) {
      el.inductionSystems.forEach(sys => {
        const preset = (library.inductionSystems || []).find(s => s.id === sys.presetId);
        const validation = validateInduction(sys, el.length, el.depth, el.inductionSystems, el.cutouts || [], preset);
        if (!validation.valid) {
          inductionErrors.push({ element: el.name, system: sys.name, errors: validation.errors });
        }
      });
    }
  });
  const hasInductionErrors = inductionErrors.length > 0;
  const hasAnyErrors = hasCutoutErrors || hasInductionErrors;
  
  const count = tiles.length;
  
  // Calculate length totals for blaturi (slabs) and contrablaturi (backsplashes)
  // Standard: width/height ≤ 70cm, Atypical: > 70cm
  const slabPieces = pieces.filter(p => p.pieceType === 'slab');
  const backsplashPieces = pieces.filter(p => p.pieceType === 'backsplash');
  
  // Blaturi: pieceW is length on tile, pieceH is depth/width on tile
  // Use pieceH (actual dimension on tile after rotation) for standard/atypical classification
  const slabStandard = slabPieces.filter(p => p.pieceH <= 70);
  const slabAtypical = slabPieces.filter(p => p.pieceH > 70);
  const slabStandardLength = slabStandard.reduce((sum, p) => sum + p.pieceW, 0) / 100; // in meters
  const slabAtypicalLength = slabAtypical.reduce((sum, p) => sum + p.pieceW, 0) / 100;
  
  // Contrablaturi: pieceW is length on tile, pieceH is height on tile
  // If rotated (grainLengthwise: false), pieceH becomes the original width which is usually ≤70
  const backsplashStandard = backsplashPieces.filter(p => p.pieceH <= 70);
  const backsplashAtypical = backsplashPieces.filter(p => p.pieceH > 70);
  const backsplashStandardLength = backsplashStandard.reduce((sum, p) => sum + p.pieceW, 0) / 100;
  const backsplashAtypicalLength = backsplashAtypical.reduce((sum, p) => sum + p.pieceW, 0) / 100;
  
  // Group tiles by material type for display
  const tilesByMaterial = {};
  tiles.forEach((tile, i) => {
    const materialType = getMaterialType(tile.colorId) || 'Altele';
    if (!tilesByMaterial[materialType]) {
      tilesByMaterial[materialType] = [];
    }
    tilesByMaterial[materialType].push({ ...tile, originalIndex: i });
  });
  
  // Group tiles by color and format for summary, including efficiency
  const tilesGroupedByColor = {};
  tiles.forEach((tile, idx) => {
    const color = getColorById(tile.colorId);
    const format = tile.format;
    const key = `${color?.name || 'N/A'}|${format ? `${format.length}×${format.width}` : '-'}`;
    
    // Calculate efficiency for this tile
    const tilePieces = pieces.filter(p => p.tileIndex === idx);
    const tileArea = format ? format.length * format.width : 320 * 160;
    const usedArea = tilePieces.reduce((sum, p) => sum + (p.pieceW * p.pieceH), 0);
    const efficiency = tileArea > 0 ? Math.round((usedArea / tileArea) * 100) : 0;
    
    if (!tilesGroupedByColor[key]) {
      tilesGroupedByColor[key] = { colorName: color?.name || 'N/A', format: format ? `${format.length}×${format.width}` : '-', count: 0, totalEfficiency: 0 };
    }
    tilesGroupedByColor[key].count++;
    tilesGroupedByColor[key].totalEfficiency += efficiency;
  });
  const tilesGroupedList = Object.values(tilesGroupedByColor).map(g => ({
    ...g,
    avgEfficiency: g.count > 0 ? Math.round(g.totalEfficiency / g.count) : 0
  }));
  
  // Calculate overall average efficiency
  const overallAvgEfficiency = tiles.length > 0 
    ? Math.round(tilesGroupedList.reduce((sum, g) => sum + g.totalEfficiency, 0) / tiles.length)
    : 0;
  
  // Load html2canvas dynamically and capture tiles area only
  const captureFooter = async () => {
    try {
      // Dynamically load html2canvas if not already loaded
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      
      // Capture only the tiles area, not the whole footer
      if (tilesAreaRef.current && window.html2canvas) {
        const canvas = await window.html2canvas(tilesAreaRef.current, {
          backgroundColor: '#0d0d0d',
          scale: 2, // Higher quality
          logging: false,
          useCORS: true,
        });
        return canvas.toDataURL('image/png');
      }
    } catch (e) {
      console.error('Error capturing footer:', e);
    }
    return null;
  };
  
  // Send quote request
  const sendQuoteRequest = async () => {
    setSendingQuote(true);
    setQuoteStatus(null);
    
    try {
      // Save phone to profile if user entered it in dialog
      if (tempPhone.trim() && !user?.phone && user?.id) {
        try {
          await supabase
            .from('profiles')
            .upsert({ 
              id: user.id, 
              phone: tempPhone.trim() 
            }, { 
              onConflict: 'id' 
            });
          // Update local user state with new phone
          // This prevents the phone input from showing again in future dialogs
        } catch (e) {
          console.error('Error saving phone to profile:', e);
        }
      }
      
      // Capture images - for 3D we need to get the WebGL canvas
      let preview3DImage = null;
      try {
        // Find the WebGL canvas inside the container
        const container = canvasRef?.current;
        if (container) {
          const webglCanvas = container.querySelector('canvas');
          if (webglCanvas) {
            preview3DImage = webglCanvas.toDataURL('image/png');
          }
        }
      } catch (e) {
        console.error('Error capturing 3D preview:', e);
      }
      
      const footerImage = await captureFooter();
      
      // Build pieces data from computed layout (has correct dimensions after rotation)
      const piecesData = pieces.map(p => {
        const color = getColorById(p.colorId);
        const materialType = getMaterialType(p.colorId);
        const materialTypeObj = library.materialTypes.find(mt => mt.id === materialType);
        const element = elements.find(e => e.id === p.elementId);
        
        // Format cutouts for email
        const cutoutsData = element?.cutouts?.map(c => {
          const pieceDepth = element.type === 'backsplash' ? element.height : element.depth;
          const userInput = cutoutCenterToUserInput(c, element.length, pieceDepth);
          if (c.type === 'circle') {
            return `${c.name} Ø${(c.radius || 0) * 2}cm la ${Math.round(userInput.cotaStanga)}cm de stânga, ${Math.round(userInput.cotaFata)}cm de față`;
          } else {
            return `${c.name} ${c.width}×${c.height}cm la ${Math.round(userInput.cotaStanga)}cm de stânga, ${Math.round(userInput.cotaFata)}cm de față`;
          }
        }) || [];
        
        return {
          number: p.pieceNumber,
          name: p.name,
          type: p.pieceType === 'slab' ? 'island' : 'backsplash',
          // Use pieceW and pieceH which are the actual dimensions on tile after rotation
          width: p.pieceW,
          depth: p.pieceH,
          materialType: materialTypeObj?.name || materialType || '-',
          colorName: color?.name || 'N/A',
          thickness: p.thickness || '-',
          cutouts: cutoutsData,
        };
      });
      
      // Build tiles data (slabs to purchase)
      const tilesData = tiles.map((tile, idx) => {
        const color = getColorById(tile.colorId);
        const format = tile.format;
        const materialType = getMaterialType(tile.colorId);
        const materialTypeObj = library.materialTypes.find(mt => mt.id === materialType);
        const manufacturer = library.manufacturers.find(m => m.id === color?.manufacturer);
        
        // Calculate efficiency for this tile
        const tilePiecesForCalc = pieces.filter(p => p.tileIndex === idx);
        const tileArea = format ? format.length * format.width : 320 * 160;
        const usedArea = tilePiecesForCalc.reduce((sum, p) => sum + (p.pieceW * p.pieceH), 0);
        const efficiency = tileArea > 0 ? Math.round((usedArea / tileArea) * 100) : 0;
        
        return {
          number: idx + 1,
          materialType: materialTypeObj?.name || materialType || '-',
          manufacturer: manufacturer?.name || '-',
          colorName: color?.name || 'N/A',
          dimensions: format ? `${format.length}×${format.width}` : '-',
          thickness: tile.thickness || format?.thickness || '-',
          efficiency,
        };
      });
      
      // Group tiles by material/manufacturer/color/dimensions/thickness for summary
      // Also calculate average efficiency per group
      const tilesSummary = {};
      tilesData.forEach(tile => {
        const key = `${tile.materialType}|${tile.manufacturer}|${tile.colorName}|${tile.dimensions}|${tile.thickness}`;
        if (!tilesSummary[key]) {
          tilesSummary[key] = { ...tile, count: 0, totalEfficiency: 0 };
        }
        tilesSummary[key].count++;
        tilesSummary[key].totalEfficiency += tile.efficiency;
      });
      const tilesGrouped = Object.values(tilesSummary).map(t => ({
        ...t,
        avgEfficiency: Math.round(t.totalEfficiency / t.count)
      }));
      
      const requestData = {
        projectName: project?.name || 'Proiect fără nume',
        projectDescription: project?.description || '',
        userName: user?.name || '',
        userEmail: user?.email || '',
        userPhone: user?.phone || tempPhone || '',
        // Stats
        totalPieces: pieces.length,
        totalArea: parseFloat(totalArea.toFixed(2)),
        totalSlabs: count,
        overallAvgEfficiency,
        // Cutting stats
        cuttingStats: {
          external: parseFloat(cuttingStats.external.toFixed(2)),
          internal: parseFloat(cuttingStats.internal.toFixed(2)),
          cutoutCount: cuttingStats.cutoutCount,
          cutoutArea: parseFloat(cuttingStats.cutoutArea.toFixed(2)),
        },
        // Blaturi
        slabStandard: slabStandardLength > 0 ? parseFloat(slabStandardLength.toFixed(2)) : null,
        slabAtypical: slabAtypicalLength > 0 ? parseFloat(slabAtypicalLength.toFixed(2)) : null,
        // Contrablaturi
        backsplashStandard: backsplashStandardLength > 0 ? parseFloat(backsplashStandardLength.toFixed(2)) : null,
        backsplashAtypical: backsplashAtypicalLength > 0 ? parseFloat(backsplashAtypicalLength.toFixed(2)) : null,
        // Detailed pieces
        pieces: piecesData,
        // Tiles/slabs to purchase (grouped)
        tilesGrouped,
        // Images
        preview3DImage,
        footerImage,
      };
      
      const response = await fetch('https://configuratorform.alecsandru-gosav.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setQuoteStatus('success');
        setTimeout(() => setQuoteStatus(null), 5000);
      } else {
        throw new Error(result.error || 'Failed to send');
      }
    } catch (error) {
      console.error('Error sending quote:', error);
      setQuoteStatus('error');
      setTimeout(() => setQuoteStatus(null), 5000);
    } finally {
      setSendingQuote(false);
    }
  };
  
  // ============================================
  // DXF EXPORT FUNCTION
  // ============================================
  const exportDXF = () => {
    // DXF uses mm, our data is in cm - convert
    const CM_TO_MM = 10;
    
    // Spacing between tiles in the DXF layout (mm)
    const TILE_SPACING = 100; // 100mm = 10cm spacing between tiles
    
    // Calculate tile positions (same arrangement as footer - tiles side by side)
    // In footer: tileW = format.length, tileH = format.width
    const tilePositions = [];
    let currentX = 0;
    let currentY = 0;
    let rowMaxHeight = 0;
    const maxRowWidth = 10000; // Max row width before wrapping (mm)
    
    tiles.forEach((tile, tileIdx) => {
      // Match footer logic: length on X axis, width on Y axis
      const tileW = (tile.format?.length || 320) * CM_TO_MM;
      const tileH = (tile.format?.width || 160) * CM_TO_MM;
      
      // Check if we need to wrap to next row
      if (currentX + tileW > maxRowWidth && currentX > 0) {
        currentX = 0;
        currentY -= rowMaxHeight + TILE_SPACING;
        rowMaxHeight = 0;
      }
      
      tilePositions.push({
        tileIdx,
        x: currentX,
        y: currentY,
        w: tileW,
        h: tileH
      });
      
      currentX += tileW + TILE_SPACING;
      rowMaxHeight = Math.max(rowMaxHeight, tileH);
    });
    
    // DXF Header
    let dxf = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1014
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
4
0
LAYER
2
PLACI
70
0
62
8
6
CONTINUOUS
0
LAYER
2
COTA_ROSU
70
0
62
6
6
DASHED
0
LAYER
2
PIESE
70
0
62
5
6
CONTINUOUS
0
LAYER
2
DECUPAJE
70
0
62
1
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
`;
    
    // Helper to create a closed polyline (LWPOLYLINE)
    const createPolyline = (points, layer) => {
      let pl = `0
LWPOLYLINE
8
${layer}
90
${points.length}
70
1
`;
      points.forEach(p => {
        pl += `10
${p.x.toFixed(3)}
20
${p.y.toFixed(3)}
`;
      });
      return pl;
    };
    
    // Helper to create a circle
    const createCircle = (cx, cy, radius, layer) => {
      return `0
CIRCLE
8
${layer}
10
${cx.toFixed(3)}
20
${cy.toFixed(3)}
40
${radius.toFixed(3)}
`;
    };
    
    // Helper to create text (MTEXT for multiline support)
    const createText = (x, y, text, height, layer, alignment = 'center') => {
      // alignment: 'center', 'left', 'right'
      // Use attachment point: 1=TL, 2=TC, 3=TR, 4=ML, 5=MC, 6=MR, 7=BL, 8=BC, 9=BR
      const attachmentPoint = alignment === 'center' ? 5 : (alignment === 'left' ? 4 : 6);
      return `0
MTEXT
8
${layer}
10
${x.toFixed(3)}
20
${y.toFixed(3)}
40
${height.toFixed(3)}
71
${attachmentPoint}
1
${text}
`;
    };
    
    // Helper to create rectangle polyline with optional corner radius
    const createRectangle = (x, y, w, h, cornerRadius, layer) => {
      if (cornerRadius && cornerRadius > 0) {
        // Rectangle with rounded corners - approximate with more points
        const r = Math.min(cornerRadius, w / 2, h / 2);
        const segments = 8; // segments per corner
        const points = [];
        
        // Bottom left corner
        for (let i = 0; i <= segments; i++) {
          const angle = Math.PI + (Math.PI / 2) * (i / segments);
          points.push({ x: x + r + r * Math.cos(angle), y: y + r + r * Math.sin(angle) });
        }
        // Bottom right corner
        for (let i = 0; i <= segments; i++) {
          const angle = Math.PI * 1.5 + (Math.PI / 2) * (i / segments);
          points.push({ x: x + w - r + r * Math.cos(angle), y: y + r + r * Math.sin(angle) });
        }
        // Top right corner
        for (let i = 0; i <= segments; i++) {
          const angle = 0 + (Math.PI / 2) * (i / segments);
          points.push({ x: x + w - r + r * Math.cos(angle), y: y + h - r + r * Math.sin(angle) });
        }
        // Top left corner
        for (let i = 0; i <= segments; i++) {
          const angle = Math.PI / 2 + (Math.PI / 2) * (i / segments);
          points.push({ x: x + r + r * Math.cos(angle), y: y + h - r + r * Math.sin(angle) });
        }
        
        return createPolyline(points, layer);
      } else {
        // Simple rectangle
        const points = [
          { x: x, y: y },
          { x: x + w, y: y },
          { x: x + w, y: y + h },
          { x: x, y: y + h }
        ];
        return createPolyline(points, layer);
      }
    };
    
    // Draw tiles (PLACI layer) with labels above
    tilePositions.forEach((tp, idx) => {
      const tile = tiles[tp.tileIdx];
      const tileBottom = tp.y - tp.h;
      
      // Draw tile rectangle
      dxf += createRectangle(tp.x, tileBottom, tp.w, tp.h, 0, 'PLACI');
      
      // Get tile info for label
      const colorData = getColorById(tile.colorId);
      const format = tile.format || { length: 320, width: 160 };
      const thickness = tile.thickness || 12;
      
      // Draw COTA_ROSU - rough cut offset for the tile (1cm = 10mm larger on each side)
      const OFFSET = 10; // 1cm = 10mm
      dxf += createRectangle(
        tp.x - OFFSET, 
        tileBottom - OFFSET, 
        tp.w + OFFSET * 2, 
        tp.h + OFFSET * 2, 
        0, 
        'COTA_ROSU'
      );
      
      // Label at top-left of tile: "Culoare Dimensiuni Grosime" - on PLACI layer
      const labelText = `${colorData.name} ${format.length}x${format.width}cm ${thickness}mm`;
      const labelX = tp.x; // Left edge of tile
      const labelY = tp.y + 80; // 80mm above tile (30 + 50)
      dxf += createText(labelX, labelY, labelText, 100, 'PLACI', 'left'); // 100mm text height (40 * 2.5), left-aligned
    });
    
    // Draw pieces (PIESE layer) and cutouts (DECUPAJE layer)
    piecesWithManualPositions.forEach(p => {
      const tp = tilePositions[p.tileIndex];
      if (!tp) return;
      
      // Piece position relative to tile (convert from cm to mm)
      // In footer: p.x is from left, p.y is from TOP (CSS coordinates)
      // In DXF: Y increases upward, so we need to invert Y
      // Tile bottom-left is at (tp.x, tp.y - tp.h)
      // Piece in footer: top at p.y, bottom at p.y + pieceH
      // In DXF: bottom at tileTop - p.y - pieceH, top at tileTop - p.y
      const pieceX = tp.x + p.x * CM_TO_MM;
      const pieceW = p.pieceW * CM_TO_MM;
      const pieceH = p.pieceH * CM_TO_MM;
      // Convert from top-down (footer) to bottom-up (DXF)
      const pieceY = tp.y - (p.y * CM_TO_MM) - pieceH;
      
      // Draw piece outline (finished size)
      dxf += createRectangle(pieceX, pieceY, pieceW, pieceH, 0, 'PIESE');
      
      // Piece center for cutout calculations
      const pieceCenterX = pieceX + pieceW / 2;
      const pieceCenterY = pieceY + pieceH / 2;
      
      // Piece label in BOTTOM-LEFT corner: "#01 200×60cm" - on PIESE layer
      const pieceLabel = `#${p.pieceNumber} ${p.pieceW}x${p.pieceH}cm`;
      const labelX = pieceX + 20; // 20mm from left edge
      const labelY = pieceY + 20; // 20mm from bottom edge
      dxf += createText(labelX, labelY, pieceLabel, 25, 'PIESE', 'left'); // 25mm text height, left-aligned, on PIESE layer
      
      // Draw cutouts if any
      const element = elements.find(e => e.id === p.elementId);
      if (element?.cutouts) {
        element.cutouts.forEach((cutout, cutoutIdx) => {
          // Cutout center coords are stored as cutout.center.x (along piece length) and cutout.center.z (along piece depth)
          // These are relative to piece center in cm
          // In DXF: Y increases upward, piece depth (z) maps to DXF Y axis
          const isRotated = p.isRotated;
          
          // Get cutout center relative to piece center (in cm)
          const cutoutCenterX = cutout.center?.x || 0; // Along piece length
          const cutoutCenterZ = cutout.center?.z || 0; // Along piece depth (front/back)
          
          // Cutout number (e.g., "D1", "D2")
          const cutoutNumber = `D${cutoutIdx + 1}`;
          
          if (cutout.type === 'circle') {
            const radius = (cutout.radius || 1.6) * CM_TO_MM;
            let cx, cy;
            
            if (isRotated) {
              // Rotated 90° CW on tile: piece length becomes vertical, depth becomes horizontal
              cx = pieceCenterX + cutoutCenterZ * CM_TO_MM;
              cy = pieceCenterY + cutoutCenterX * CM_TO_MM;
            } else {
              // Not rotated: piece length is horizontal (X), depth is vertical (Y in DXF)
              cx = pieceCenterX + cutoutCenterX * CM_TO_MM;
              cy = pieceCenterY - cutoutCenterZ * CM_TO_MM; // Flip Z because DXF Y is up, our Z is "forward"
            }
            
            dxf += createCircle(cx, cy, radius, 'DECUPAJE');
            
            // Cutout label: "D1 Ø32" (number and diameter in mm) - on DECUPAJE layer
            const diameterMm = (cutout.radius || 1.6) * 2 * 10; // Convert cm to mm
            const cutoutLabel = `${cutoutNumber} O${diameterMm.toFixed(0)}mm`;
            dxf += createText(cx, cy, cutoutLabel, 15, 'DECUPAJE'); // 15mm text height, on DECUPAJE layer
          } else {
            // Rectangle cutout
            const cutW = (cutout.width || 10) * CM_TO_MM;
            const cutH = (cutout.height || 10) * CM_TO_MM;
            const cornerR = (cutout.cornerRadius || 0) * CM_TO_MM;
            
            let cutX, cutY, drawW, drawH, labelCx, labelCy;
            
            if (isRotated) {
              // Rotated: swap dimensions, length->Y, depth->X
              const cx = pieceCenterX + cutoutCenterZ * CM_TO_MM;
              const cy = pieceCenterY + cutoutCenterX * CM_TO_MM;
              // When rotated, cutout.width (along length) becomes vertical, height (along depth) becomes horizontal
              cutX = cx - cutH / 2;
              cutY = cy - cutW / 2;
              drawW = cutH;
              drawH = cutW;
              labelCx = cx;
              labelCy = cy;
            } else {
              // Not rotated: width along X, height along Y
              const cx = pieceCenterX + cutoutCenterX * CM_TO_MM;
              const cy = pieceCenterY - cutoutCenterZ * CM_TO_MM;
              cutX = cx - cutW / 2;
              cutY = cy - cutH / 2;
              drawW = cutW;
              drawH = cutH;
              labelCx = cx;
              labelCy = cy;
            }
            
            dxf += createRectangle(cutX, cutY, drawW, drawH, cornerR, 'DECUPAJE');
            
            // Cutout label: "D1 50x40" + corner radius if exists - on DECUPAJE layer
            let cutoutLabel = `${cutoutNumber} ${cutout.width || 10}x${cutout.height || 10}`;
            if (cutout.cornerRadius && cutout.cornerRadius > 0) {
              const cornerRadiusMm = cutout.cornerRadius * 10; // Convert cm to mm
              cutoutLabel += ` R${cornerRadiusMm.toFixed(0)}`;
            }
            dxf += createText(labelCx, labelCy, cutoutLabel, 15, 'DECUPAJE'); // 15mm text height, on DECUPAJE layer
          }
        });
      }
    });
    
    // DXF Footer
    dxf += `0
ENDSEC
0
EOF
`;
    
    // Download the file
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name || 'export'}_layout.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  return (
    <div 
      ref={footerRef}
      style={{ 
        borderTop: '1px solid #2a2a2a', 
        background: '#0d0d0d',
        padding: '12px 20px',
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
        flexShrink: 0,
        position: 'relative',
        zIndex: 100,
        minHeight: '80px',
    }}>
      {elements.length === 0 ? (
        // Empty state
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: '#666',
          fontSize: '13px',
          padding: '20px',
        }}>
          <span style={{ marginRight: '8px' }}>📐</span>
          Adaugă un blat sau contrablat pentru a vedea încadrarea pe plăci
        </div>
      ) : (
        <>
      {/* Combined Summary Card - Restructured */}
      <div style={{ 
        background: exceedingPieces.length > 0 ? 'rgba(201,98,98,0.1)' : 'rgba(201,169,98,0.1)', 
        border: exceedingPieces.length > 0 ? '1px solid #c96262' : '1px solid #c9a962', 
        padding: '8px 10px',
        minWidth: '160px',
        flexShrink: 0,
        fontSize: '9px',
      }}>
        {/* PLĂCI Section */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ color: '#c9a962', fontWeight: 600, marginBottom: '3px' }}>
            📦 Plăci: {count} · {overallAvgEfficiency}%
          </div>
          {tilesGroupedList.map((g, i) => (
            <div key={i} style={{ color: '#888', paddingLeft: '8px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <span>{g.count}× {g.colorName} {g.format}</span>
              <span style={{ 
                color: g.avgEfficiency >= 70 ? '#4a9' : g.avgEfficiency >= 50 ? '#c9a962' : '#c96262',
                fontWeight: 500
              }}>{g.avgEfficiency}%</span>
            </div>
          ))}
        </div>

        {/* PIESE Section */}
        <div style={{ borderTop: '1px solid rgba(201,169,98,0.3)', paddingTop: '6px', marginBottom: '6px' }}>
          <div style={{ color: '#c9a962', fontWeight: 600, marginBottom: '3px' }}>
            🧩 Piese: {pieces.length}
          </div>
          <div style={{ color: '#888', paddingLeft: '8px' }}>
            {parseFloat(totalArea.toFixed(2))}m² · {cuttingStats.external.toFixed(2)}ml debitare
          </div>
        </div>

        {/* DECUPAJE Section */}
        {cuttingStats.cutoutCount > 0 && (
          <div style={{ borderTop: '1px solid rgba(201,169,98,0.3)', paddingTop: '6px', marginBottom: '6px' }}>
            <div style={{ color: '#c9a962', fontWeight: 600, marginBottom: '3px' }}>
              ✂️ Decupaje: {cuttingStats.cutoutCount}
            </div>
            <div style={{ color: '#888', paddingLeft: '8px' }}>
              {cuttingStats.cutoutArea.toFixed(2)}m² · {cuttingStats.internal.toFixed(2)}ml
            </div>
          </div>
        )}

        {/* TIPURI PIESE Section */}
        <div style={{ borderTop: '1px solid rgba(201,169,98,0.3)', paddingTop: '6px' }}>
          <div style={{ color: '#c9a962', fontWeight: 600, marginBottom: '3px' }}>
            📏 Metraj liniar:
          </div>
          {/* Blaturi standard */}
          {slabStandardLength > 0 && (
            <div style={{ color: '#888', paddingLeft: '8px' }}>
              {slabStandard.length}× blat std · {parseFloat(slabStandardLength.toFixed(2))}ml
            </div>
          )}
          {/* Blaturi atipice */}
          {slabAtypicalLength > 0 && (
            <div style={{ color: '#e8a87c', paddingLeft: '8px' }}>
              {slabAtypical.length}× blat atipic · {parseFloat(slabAtypicalLength.toFixed(2))}ml
            </div>
          )}
          {/* Contrablaturi standard */}
          {backsplashStandardLength > 0 && (
            <div style={{ color: '#888', paddingLeft: '8px' }}>
              {backsplashStandard.length}× c.blat std · {parseFloat(backsplashStandardLength.toFixed(2))}ml
            </div>
          )}
          {/* Contrablaturi atipice */}
          {backsplashAtypicalLength > 0 && (
            <div style={{ color: '#e8a87c', paddingLeft: '8px' }}>
              {backsplashAtypical.length}× c.blat atipic · {parseFloat(backsplashAtypicalLength.toFixed(2))}ml
            </div>
          )}
        </div>

        {/* Warning for exceeding pieces */}
        {exceedingPieces.length > 0 && (
          <div style={{ 
            marginTop: '6px', 
            padding: '3px 6px', 
            background: 'rgba(201,98,98,0.2)', 
            borderRadius: '3px',
            color: '#c96262',
            textAlign: 'center'
          }}>
            ⚠️ {exceedingPieces.length} piese depășesc!
          </div>
        )}
      </div>

      {/* Tile Layout */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        {/* Inner div that fits exactly to content - this is what we capture */}
        <div 
          ref={tilesAreaRef}
          style={{ 
            display: 'inline-flex', // Shrinks to fit content
            gap: '15px', 
            flexWrap: 'nowrap', 
            alignItems: 'flex-start', 
            padding: '8px 12px', // Uniform padding
            background: '#0d0d0d',
          }}
        >
          {Object.entries(tilesByMaterial).map(([materialType, materialTiles]) => (
            <div key={materialType} style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
              {/* Material type header */}
              <div style={{ 
                fontSize: '11px', 
                color: '#c9a962', 
                textTransform: 'uppercase', 
                letterSpacing: '1px',
                fontWeight: 600,
                borderBottom: '1px solid rgba(201,169,98,0.3)',
                paddingBottom: '4px'
              }}>
                {materialType}
              </div>
              
              {/* Tiles in this material group */}
              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                {materialTiles.map((tile) => {
                  const tileIdx = tile.originalIndex;
                  const colorData = getColorById(tile.colorId);
                  const format = tile.format || { length: 320, width: 160 };
                  const isLight = parseInt((colorData.color || '#666').replace('#', ''), 16) > 0x888888;
                  
                  // Tile dimensions in pixels
                  const tileWpx = format.length * uniformScale;
                  const tileHpx = format.width * uniformScale;
                  
                  // Get pieces for this tile (using manual positions if set)
                  const tilePieces = piecesWithManualPositions.filter(p => p.tileIndex === tileIdx);
                  
                  // Calculate efficiency (used area / total area * 100)
                  const tileArea = format.length * format.width;
                  const usedArea = tilePieces.reduce((sum, p) => sum + (p.pieceW * p.pieceH), 0);
                  const efficiency = tileArea > 0 ? Math.round((usedArea / tileArea) * 100) : 0;
                  
                  return (
                    <div key={tileIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                      {/* Tile header */}
                      <div style={{ fontSize: '14px', color: '#999', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <div style={{ 
                          width: 12, 
                          height: 12, 
                          backgroundImage: colorData.texture ? `url(${colorData.texture})` : 'none',
                          backgroundColor: colorData.texture ? 'transparent' : colorData.color,
                          backgroundSize: '100% 100%',
                          backgroundPosition: '0 0',
                          backgroundRepeat: 'no-repeat',
                          border: '1px solid #444', 
                          borderRadius: '2px' 
                        }} />
                        <span style={{ fontWeight: 500 }}>{colorData.name}</span>
                        <span style={{ color: '#c9a962', fontWeight: 600 }}>{tile.thickness}mm</span>
                      </div>
                      
                      {/* Tile with texture - NO cover/center, exact mapping */}
                      <div 
                        ref={el => { tileRefsMap.current[tileIdx] = el; }}
                        style={{ 
                          width: tileWpx, 
                          height: tileHpx, 
                          backgroundImage: colorData.texture ? `url(${colorData.texture})` : 'none',
                          backgroundColor: colorData.texture ? 'transparent' : colorData.color,
                          backgroundSize: `${tileWpx}px ${tileHpx}px`,
                          backgroundPosition: '0 0',
                          backgroundRepeat: 'no-repeat',
                          border: draggingPiece && tiles[draggingPiece.tileIdx]?.colorId === tile.colorId && tiles[draggingPiece.tileIdx]?.thickness === tile.thickness ? '2px dashed #c9a962' : '1px solid #555', 
                          position: 'relative', 
                          borderRadius: '2px',
                          overflow: 'visible',
                        }}
                      >
                        {/* Tile number in background */}
                        <span style={{ 
                          position: 'absolute', 
                          top: '50%', 
                          left: '50%', 
                          transform: 'translate(-50%,-50%)', 
                          color: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)', 
                          fontSize: '24px',
                          fontWeight: 'bold',
                          pointerEvents: 'none',
                          zIndex: 0,
                        }}>{tileIdx + 1}</span>
                        
                        {/* Snap indicators */}
                        {snapIndicators.filter(ind => ind.tileIdx === tileIdx).map((ind, i) => {
                          const color = ind.isNeighbor ? '#4a9fff' : '#00ff88'; // Blue for neighbor, green for local
                          return ind.type === 'vertical' ? (
                            <div
                              key={`snap-${i}`}
                              style={{
                                position: 'absolute',
                                left: ind.x * uniformScale - 1,
                                top: ind.y1 * uniformScale,
                                width: 2,
                                height: (ind.y2 - ind.y1) * uniformScale,
                                backgroundColor: color,
                                boxShadow: `0 0 4px ${color}`,
                                pointerEvents: 'none',
                                zIndex: 200,
                              }}
                            />
                          ) : (
                            <div
                              key={`snap-${i}`}
                              style={{
                                position: 'absolute',
                                left: ind.x1 * uniformScale,
                                top: ind.y * uniformScale - 1,
                                width: (ind.x2 - ind.x1) * uniformScale,
                                height: 2,
                                backgroundColor: color,
                                boxShadow: `0 0 4px ${color}`,
                                pointerEvents: 'none',
                                zIndex: 200,
                              }}
                            />
                          );
                        })}
                        
                        {/* Pieces on this tile - each piece shows its portion of the texture */}
                        {tilePieces.map((p, j) => {
                          const pieceLeftPx = p.x * uniformScale;
                          const pieceTopPx = p.y * uniformScale;
                          const pieceWpx = p.pieceW * uniformScale;
                          const pieceHpx = p.pieceH * uniformScale;
                          
                          const pieceElement = elements.find(e => e.id === p.elementId);
                          const isDirectlySelected = selectedIds.includes(p.elementId);
                          const isGroupSelected = pieceElement?.groupId && elements.some(e => e.groupId === pieceElement.groupId && selectedIds.includes(e.id));
                          const shouldHighlight = isDirectlySelected || isGroupSelected;
                          
                          const exceeds = p.exceeds;
                          const isLeftWaterfall = p.waterfallSide === 'left';
                          const isRightWaterfall = p.waterfallSide === 'right';
                          const isSlab = p.pieceType === 'slab';
                          
                          // Check if this slab has waterfall (for showing joint edges)
                          const slabHasLeftWf = isSlab && p.slabGroup && tilePieces.some(tp => tp.slabGroup === p.slabGroup && tp.waterfallSide === 'left');
                          const slabHasRightWf = isSlab && p.slabGroup && tilePieces.some(tp => tp.slabGroup === p.slabGroup && tp.waterfallSide === 'right');
                          
                          // Determine overlay colors for selection/exceeds
                          let overlayColor, borderStyle, textColor, boxShadowColor;
                          if (exceeds) {
                            overlayColor = 'rgba(201, 98, 98, 0.7)';
                            borderStyle = '2px solid #c96262';
                            textColor = '#fff';
                            boxShadowColor = 'rgba(201, 98, 98, 0.8)';
                          } else if (shouldHighlight && isLeftWaterfall) {
                            overlayColor = 'rgba(74, 144, 217, 0.5)';
                            borderStyle = '2px solid #4a90d9';
                            textColor = '#fff';
                            boxShadowColor = 'rgba(74, 144, 217, 0.8)';
                          } else if (shouldHighlight && isRightWaterfall) {
                            overlayColor = 'rgba(92, 184, 92, 0.5)';
                            borderStyle = '2px solid #5cb85c';
                            textColor = '#fff';
                            boxShadowColor = 'rgba(92, 184, 92, 0.8)';
                          } else if (shouldHighlight) {
                            // Use group color for grouped elements, gold for ungrouped
                            const groupColorData = getGroupColor(pieceElement?.groupId);
                            if (groupColorData) {
                              overlayColor = `hsla(${groupColorData.hue}, 60%, 50%, 0.5)`;
                              borderStyle = `2px solid ${groupColorData.hsl}`;
                              boxShadowColor = `hsla(${groupColorData.hue}, 60%, 50%, 0.8)`;
                            } else {
                              overlayColor = 'rgba(201, 169, 98, 0.5)';
                              borderStyle = '2px solid #c9a962';
                              boxShadowColor = 'rgba(201, 169, 98, 0.8)';
                            }
                            textColor = '#fff';
                          } else {
                            overlayColor = 'transparent';
                            borderStyle = `1px solid ${isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'}`;
                            textColor = isLight ? '#000' : '#fff';
                            boxShadowColor = 'none';
                          }
                          
                          // Check if this piece is being dragged
                          const isDragging = draggingPiece && 
                            draggingPiece.piece.elementId === p.elementId && 
                            draggingPiece.piece.key === p.key;
                          
                          // Check if pending drag on this piece
                          const isPendingDrag = pendingDrag && 
                            pendingDrag.piece.elementId === p.elementId && 
                            pendingDrag.piece.key === p.key;
                          
                          // Calculate display position (with drag offset if dragging)
                          const displayLeft = isDragging ? pieceLeftPx + dragOffset.x : pieceLeftPx;
                          const displayTop = isDragging ? pieceTopPx + dragOffset.y : pieceTopPx;
                          
                          return (
                            <div 
                              key={j} 
                              onMouseDown={(e) => handleMouseDown(e, p, tileIdx)}
                              onMouseUp={(e) => handleMouseUp(e, p)}
                              style={{
                                position: 'absolute', 
                                left: displayLeft, 
                                top: displayTop,
                                width: pieceWpx, 
                                height: pieceHpx,
                                // Show the exact portion of texture for this piece
                                backgroundImage: colorData.texture ? `url(${colorData.texture})` : 'none',
                                backgroundSize: `${tileWpx}px ${tileHpx}px`,
                                backgroundPosition: `-${pieceLeftPx}px -${pieceTopPx}px`,
                                backgroundRepeat: 'no-repeat',
                                overflow: 'hidden',
                                boxSizing: 'border-box',
                                cursor: isDragging ? 'grabbing' : (isPendingDrag ? 'grabbing' : 'grab'),
                                zIndex: isDragging ? 100 : (exceeds ? 11 : (shouldHighlight ? 10 : 1)),
                                opacity: isDragging ? 0.8 : 1,
                                outline: p.isManual ? '2px dashed #c9a962' : 'none',
                                outlineOffset: '-2px',
                              }}
                              title={`${p.name}: ${p.pieceW}×${p.pieceH}cm${exceeds ? ' ⚠️ DEPĂȘEȘTE!' : ''}${isLeftWaterfall ? ' (Cascadă Stânga)' : ''}${isRightWaterfall ? ' (Cascadă Dreapta)' : ''}${p.isManual ? ' (Poziție manuală)' : ''}`}
                            >
                              {/* Semi-transparent overlay for selection/status */}
                              <div style={{
                                position: 'absolute',
                                inset: 0,
                                backgroundColor: overlayColor,
                                border: borderStyle,
                                boxShadow: boxShadowColor !== 'none' ? `0 0 8px ${boxShadowColor}` : 'none',
                              }}>
                                {/* Render cutouts as dark overlays - BEHIND text */}
                                {pieceElement?.cutouts?.map((cutout, cutIdx) => {
                                  // Get piece dimensions in cm
                                  const pieceLengthCm = pieceElement.length;
                                  const pieceDepthCm = pieceElement.type === 'backsplash' ? pieceElement.height : pieceElement.depth;
                                  
                                  // Convert cutout center from internal coords to user coords (from corner)
                                  const userInput = cutoutCenterToUserInput(cutout, pieceLengthCm, pieceDepthCm);
                                  
                                  // Check if piece is rotated on tile (pieceW/H might be swapped)
                                  const isRotatedOnTile = p.rotated;
                                  
                                  let cutLeftPx, cutTopPx, cutWPx, cutHPx;
                                  
                                  if (cutout.type === 'circle') {
                                    const diameterCm = (cutout.radius || 0) * 2;
                                    if (isRotatedOnTile) {
                                      // Rotated 90° CW: cotaStanga->X (from right), cotaFata->Y (from bottom)
                                      // When rotated, pieceW=depth, pieceH=length on tile
                                      cutLeftPx = (pieceDepthCm - userInput.cotaFata - (cutout.radius || 0)) * uniformScale;
                                      cutTopPx = (pieceLengthCm - userInput.cotaStanga - (cutout.radius || 0)) * uniformScale;
                                      cutWPx = diameterCm * uniformScale;
                                      cutHPx = diameterCm * uniformScale;
                                    } else {
                                      cutLeftPx = (userInput.cotaStanga - (cutout.radius || 0)) * uniformScale;
                                      // Invert Y: cotaFata is from front edge, but in footer top=0 is back edge
                                      cutTopPx = (pieceDepthCm - userInput.cotaFata - (cutout.radius || 0)) * uniformScale;
                                      cutWPx = diameterCm * uniformScale;
                                      cutHPx = diameterCm * uniformScale;
                                    }
                                    
                                    return (
                                      <div
                                        key={cutIdx}
                                        onClick={(e) => {
                                          if (shouldHighlight) {
                                            e.stopPropagation();
                                            setSelectedCutoutId(cutout.id);
                                          }
                                        }}
                                        style={{
                                          position: 'absolute',
                                          left: cutLeftPx,
                                          top: cutTopPx,
                                          width: cutWPx,
                                          height: cutHPx,
                                          borderRadius: '50%',
                                          background: selectedCutoutId === cutout.id ? 'rgba(0, 200, 255, 0.25)' : 'transparent',
                                          border: selectedCutoutId === cutout.id 
                                            ? '2px solid #00c8ff' 
                                            : '2px dashed rgba(0, 200, 255, 0.6)',
                                          pointerEvents: shouldHighlight ? 'auto' : 'none',
                                          cursor: shouldHighlight ? 'pointer' : 'default',
                                          boxSizing: 'border-box',
                                          boxShadow: selectedCutoutId === cutout.id ? '0 0 10px rgba(0, 200, 255, 0.5)' : 'none',
                                        }}
                                        title={cutout.name}
                                      />
                                    );
                                  } else {
                                    // Rectangle
                                    const cutW = cutout.width || 0;
                                    const cutH = cutout.height || 0;
                                    const cornerR = (cutout.cornerRadius || 0) * uniformScale;
                                    
                                    if (isRotatedOnTile) {
                                      // Rotated 90° CW: cotaStanga->X (from right), cotaFata->Y (from bottom)
                                      // When rotated, pieceW=depth, pieceH=length on tile, and W/H swap
                                      cutLeftPx = (pieceDepthCm - userInput.cotaFata - cutH) * uniformScale;
                                      cutTopPx = (pieceLengthCm - userInput.cotaStanga - cutW) * uniformScale;
                                      cutWPx = cutH * uniformScale;
                                      cutHPx = cutW * uniformScale;
                                    } else {
                                      cutLeftPx = userInput.cotaStanga * uniformScale;
                                      // Invert Y: cotaFata is from front edge, but in footer top=0 is back edge
                                      cutTopPx = (pieceDepthCm - userInput.cotaFata - cutH) * uniformScale;
                                      cutWPx = cutW * uniformScale;
                                      cutHPx = cutH * uniformScale;
                                    }
                                    
                                    return (
                                      <div
                                        key={cutIdx}
                                        onClick={(e) => {
                                          if (shouldHighlight) {
                                            e.stopPropagation();
                                            setSelectedCutoutId(cutout.id);
                                          }
                                        }}
                                        style={{
                                          position: 'absolute',
                                          left: cutLeftPx,
                                          top: cutTopPx,
                                          width: cutWPx,
                                          height: cutHPx,
                                          borderRadius: cornerR,
                                          background: selectedCutoutId === cutout.id ? 'rgba(0, 200, 255, 0.25)' : 'transparent',
                                          border: selectedCutoutId === cutout.id 
                                            ? '2px solid #00c8ff' 
                                            : '2px dashed rgba(0, 200, 255, 0.6)',
                                          pointerEvents: shouldHighlight ? 'auto' : 'none',
                                          cursor: shouldHighlight ? 'pointer' : 'default',
                                          boxSizing: 'border-box',
                                          boxShadow: selectedCutoutId === cutout.id ? '0 0 10px rgba(0, 200, 255, 0.5)' : 'none',
                                        }}
                                        title={cutout.name}
                                      />
                                    );
                                  }
                                })}

                                {/* Render induction systems as dashed outlines - only on main slab, not waterfall */}
                                {p.pieceType === 'slab' && pieceElement?.type === 'island' && pieceElement?.inductionSystems?.map((sys, indIdx) => {
                                  const pieceLengthCm = pieceElement.length;
                                  const pieceDepthCm = pieceElement.depth;
                                  const isRotatedOnTile = p.rotated;
                                  
                                  const sysW = sys.type === 'circle' ? (sys.radius || 0) * 2 : (sys.width || 0);
                                  const sysH = sys.type === 'circle' ? (sys.radius || 0) * 2 : (sys.height || 0);
                                  // cotaStanga and cotaFata from center offsets
                                  const cotaStanga = (pieceLengthCm / 2) + (sys.centerX || 0) - sysW / 2;
                                  const cotaFata = (pieceDepthCm / 2) + (sys.centerZ || 0) - sysH / 2;
                                  
                                  let iLeft, iTop, iW, iH;
                                  if (isRotatedOnTile) {
                                    iLeft = (pieceDepthCm - cotaFata - sysH) * uniformScale;
                                    iTop = (pieceLengthCm - cotaStanga - sysW) * uniformScale;
                                    iW = sysH * uniformScale;
                                    iH = sysW * uniformScale;
                                  } else {
                                    iLeft = cotaStanga * uniformScale;
                                    iTop = (pieceDepthCm - cotaFata - sysH) * uniformScale;
                                    iW = sysW * uniformScale;
                                    iH = sysH * uniformScale;
                                  }
                                  
                                  return (
                                    <div
                                      key={`ind-${indIdx}`}
                                      onClick={(e) => {
                                        if (shouldHighlight) {
                                          e.stopPropagation();
                                          setSelectedInductionId(selectedInductionId === sys.id ? null : sys.id);
                                          setSelectedCutoutId(null);
                                        }
                                      }}
                                      style={{
                                        position: 'absolute',
                                        left: iLeft,
                                        top: iTop,
                                        width: iW,
                                        height: iH,
                                        borderRadius: sys.type === 'circle' ? '50%' : '3px',
                                        background: selectedInductionId === sys.id ? 'rgba(255, 170, 60, 0.25)' : 'transparent',
                                        border: selectedInductionId === sys.id 
                                          ? '2px solid #ffaa3c' 
                                          : '2px dashed rgba(255, 170, 60, 0.6)',
                                        pointerEvents: shouldHighlight ? 'auto' : 'none',
                                        cursor: shouldHighlight ? 'pointer' : 'default',
                                        boxSizing: 'border-box',
                                        boxShadow: selectedInductionId === sys.id ? '0 0 10px rgba(255, 170, 60, 0.5)' : 'none',
                                      }}
                                      title={`⚡ ${sys.name}`}
                                    />
                                  );
                                })}
                                
                                {/* Joint edge indicators */}
                                {shouldHighlight && isLeftWaterfall && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 0, right: 0, width: 4, bottom: 0,
                                    background: '#4a90d9',
                                    borderRadius: '0 2px 2px 0',
                                  }} />
                                )}
                                {shouldHighlight && isRightWaterfall && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 0, left: 0, width: 4, bottom: 0,
                                    background: '#5cb85c',
                                    borderRadius: '2px 0 0 2px',
                                  }} />
                                )}
                                {shouldHighlight && isSlab && slabHasLeftWf && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 0, left: 0, width: 4, bottom: 0,
                                    background: '#4a90d9',
                                    borderRadius: '2px 0 0 2px',
                                  }} />
                                )}
                                {shouldHighlight && isSlab && slabHasRightWf && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 0, right: 0, width: 4, bottom: 0,
                                    background: '#5cb85c',
                                    borderRadius: '0 2px 2px 0',
                                  }} />
                                )}
                              </div>
                              
                              {/* Label - ABOVE cutouts */}
                              <div style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                color: textColor,
                                fontWeight: (shouldHighlight || exceeds) ? 600 : 500,
                                textShadow: '0 0 2px rgba(0,0,0,0.8)',
                                pointerEvents: 'none',
                                zIndex: 2,
                              }}>
                                {pieceWpx > 40 && pieceHpx > 15 ? (
                                  <span>
                                    {exceeds && '⚠️ '}
                                    {isLeftWaterfall && shouldHighlight && '◀ '}
                                    {isRightWaterfall && shouldHighlight && '▶ '}
                                    <strong style={{ color: '#c9a962' }}>{p.pieceNumber}</strong> {p.pieceW}×{p.pieceH}
                                  </span>
                                ) : pieceWpx > 25 && pieceHpx > 12 ? (
                                  <span style={{ color: '#c9a962', fontWeight: 600 }}>{p.pieceNumber}</span>
                                ) : (exceeds && pieceWpx > 20 ? '⚠️' : '')}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Tile dimensions and efficiency on same line */}
                      <div style={{ 
                        fontSize: '11px', 
                        textAlign: 'center', 
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '8px',
                      }}>
                        <span style={{ color: '#888', fontWeight: 500 }}>{format.length}×{format.width} cm</span>
                        <span style={{ 
                          fontWeight: 600,
                          color: efficiency >= 70 ? '#4a9' : efficiency >= 50 ? '#c9a962' : '#c96262'
                        }}>
                          {efficiency}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Buttons - Single vertical column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '4px', flexShrink: 0, padding: '4px 0', minWidth: '100px' }}>
          {/* Zoom Toggle Button */}
          <button
            onClick={() => setFooterZoom(!footerZoom)}
            style={{
              padding: '5px 10px',
              background: 'transparent',
              border: `1px solid ${footerZoom ? '#c9a962' : '#555'}`,
              color: footerZoom ? '#c9a962' : '#888',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
            }}
            title={footerZoom ? 'Micșorează layout' : 'Mărește layout'}
          >
            {footerZoom ? '⊖ Zoom -' : '⊕ Zoom +'}
          </button>
          
          {/* Export DXF Button */}
          <button 
            onClick={exportDXF}
            disabled={tiles.length === 0}
            style={{ 
              padding: '5px 10px', 
              background: 'transparent', 
              border: '1px solid #666',
              color: tiles.length === 0 ? '#444' : '#aaa', 
              fontWeight: 500, 
              cursor: tiles.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              opacity: tiles.length === 0 ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
            title="Exportă layout pentru CNC (DXF)"
          >
            📐 DXF
          </button>
          
          {/* Export GLB Button */}
          <button 
            onClick={exportGLB}
            disabled={elements.length === 0}
            style={{ 
              padding: '5px 10px', 
              background: 'transparent', 
              border: '1px solid #666',
              color: elements.length === 0 ? '#444' : '#aaa', 
              fontWeight: 500, 
              cursor: elements.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              opacity: elements.length === 0 ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
            title="Exportă model 3D (GLB)"
          >
            🧊 3D
          </button>
          
          {/* Solicita Oferta Button */}
          <button 
            onClick={() => setShowConfirmDialog(true)}
            disabled={sendingQuote || hasAnyErrors}
            style={{ 
              padding: '5px 10px', 
              background: (sendingQuote || hasAnyErrors) ? '#1a1a1a' : 'transparent', 
              border: `1px solid ${hasAnyErrors ? '#c96262' : '#c9a962'}`,
              color: hasAnyErrors ? '#c96262' : '#c9a962', 
              fontWeight: 600, 
              cursor: (sendingQuote || hasAnyErrors) ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              opacity: (sendingQuote || hasAnyErrors) ? 0.7 : 1,
              transition: 'all 0.2s ease',
            }}
            title={hasAnyErrors ? 'Corectează erorile la decupaje / sisteme inductie înainte de a trimite oferta' : ''}
          >
            {sendingQuote ? '⏳...' : (hasCutoutErrors ? '⛔ Erori' : '📧 Ofertă')}
          </button>
          
          {/* Reset Selected - only show if there are selected pieces with manual positions */}
          {(() => {
            const selectedManualKeys = Object.keys(manualPositions).filter(key => {
              const [elementId] = key.split('_');
              return selectedIds.includes(elementId);
            });
            return selectedManualKeys.length > 0 && (
              <button
                onClick={() => {
                  setManualPositions(prev => {
                    const newPositions = { ...prev };
                    selectedManualKeys.forEach(key => delete newPositions[key]);
                    return newPositions;
                  });
                }}
                style={{
                  padding: '5px 10px',
                  background: 'transparent',
                  border: '1px solid #c9a962',
                  color: '#c9a962',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
                title="Resetează pozițiile pieselor selectate"
              >
                ↺ Reset Sel.
              </button>
            );
          })()}
          
          {/* Reset All Manual Positions Button - only show if there are manual positions */}
          {Object.keys(manualPositions).length > 0 && (
            <button
              onClick={() => setManualPositions({})}
              style={{
                padding: '5px 10px',
                background: 'transparent',
                border: '1px solid #c96262',
                color: '#c96262',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                transition: 'all 0.2s ease',
              }}
              title="Resetează toate pozițiile manuale"
            >
              ↺ Reset All
            </button>
          )}
        {hasCutoutErrors && (
          <div style={{ fontSize: '10px', color: '#c96262', textAlign: 'center', maxWidth: '150px' }}>
            Corectează {cutoutErrors.length} eroare{cutoutErrors.length > 1 ? '' : ''} la decupaje
          </div>
        )}
        {quoteStatus === 'success' && (
          <div style={{ fontSize: '11px', color: '#4a9', textAlign: 'center' }}>
            ✓ Cererea a fost trimisă!
          </div>
        )}
        {quoteStatus === 'error' && (
          <div style={{ fontSize: '11px', color: '#c96262', textAlign: 'center' }}>
            ✗ Eroare la trimitere
          </div>
        )}
      </div>
      </>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowConfirmDialog(false)}
        >
          <div 
            style={{
              background: '#1a1a1a',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '450px',
              border: '1px solid #333',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '20px', color: '#fff', marginBottom: '16px', fontWeight: 600 }}>
              📧 Confirmare Trimitere
            </div>
            <div style={{ color: '#999', marginBottom: '24px', lineHeight: 1.6 }}>
              Ești sigur că vrei să trimiți cererea de ofertă?
              <br /><br />
              <strong style={{ color: '#c9a962' }}>{pieces.length} piese</strong> vor fi trimise către <strong style={{ color: '#c9a962' }}>contact@e-blat.com</strong>
              {user?.email && (
                <>
                  <br />
                  O copie va fi trimisă și la <strong style={{ color: '#c9a962' }}>{user.email}</strong>
                </>
              )}
            </div>
            
            {/* Phone input - only show if user doesn't have phone in profile */}
            {!user?.phone && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '8px' }}>
                  Număr de telefon <span style={{ color: '#c96262' }}>*</span>
                </label>
                <input
                  type="tel"
                  value={tempPhone}
                  onChange={(e) => setTempPhone(e.target.value)}
                  placeholder="ex: 0722 123 456"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#0d0d0d',
                    border: `1px solid ${!tempPhone.trim() ? '#c96262' : '#333'}`,
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#c9a962'}
                  onBlur={(e) => e.target.style.borderColor = !tempPhone.trim() ? '#c96262' : '#333'}
                />
                {!tempPhone.trim() && (
                  <div style={{ color: '#c96262', fontSize: '11px', marginTop: '6px' }}>
                    Numărul de telefon este obligatoriu pentru a putea fi contactat
                  </div>
                )}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowConfirmDialog(false);
                  setTempPhone('');
                }}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  border: '1px solid #444',
                  color: '#999',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Anulează
              </button>
              <button
                onClick={() => {
                  setShowConfirmDialog(false);
                  sendQuoteRequest();
                }}
                disabled={!user?.phone && !tempPhone.trim()}
                style={{
                  padding: '12px 24px',
                  background: (!user?.phone && !tempPhone.trim()) ? '#444' : '#c9a962',
                  border: 'none',
                  color: (!user?.phone && !tempPhone.trim()) ? '#888' : '#000',
                  borderRadius: '6px',
                  cursor: (!user?.phone && !tempPhone.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: (!user?.phone && !tempPhone.trim()) ? 0.7 : 1,
                }}
              >
                ✓ Trimite Cererea
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ============================================
// MAIN APP
// ============================================

export default function App() {
  const [currentView, setCurrentView] = useState('projects');
  const [currentProject, setCurrentProject] = useState(null);

  return (
    <AuthProvider>
      <AppContent
        currentView={currentView}
        setCurrentView={setCurrentView}
        currentProject={currentProject}
        setCurrentProject={setCurrentProject}
      />
    </AuthProvider>
  );
}

function AppContent({ currentView, setCurrentView, currentProject, setCurrentProject }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>e-blat<span style={{ color: '#c9a962' }}>.com</span></div>
          <div>Se încarcă...</div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (currentView === 'library') {
    return (
      <>
        <GlobalStyles />
        <MaterialLibrary onClose={() => setCurrentView('projects')} />
      </>
    );
  }

  if (currentView === 'configurator' && currentProject) {
    return (
      <>
        <GlobalStyles />
        <Configurator
          project={currentProject}
          onBack={() => {
            setCurrentView('projects');
            setCurrentProject(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <GlobalStyles />
      <ProjectsPage
        onSelectProject={(project) => {
          setCurrentProject(project);
          setCurrentView('configurator');
        }}
        onOpenLibrary={() => setCurrentView('library')}
      />
    </>
  );
}


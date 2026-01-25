import React, { useState, useEffect, createContext, useContext, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
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
  } else {
    if (!cutout.width || cutout.width < 1) errors.push('Lățimea minimă este 1cm');
    if (!cutout.height || cutout.height < 1) errors.push('Lungimea minimă este 1cm');
  }
  
  return { valid: errors.length === 0, errors, warnings, edges };
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
  
  // Rotate and position geometry based on orientation
  if (isBacksplash) {
    // Backsplash: vertical panel
    // ExtrudeGeometry creates on XY plane extruded on Z
    // We need XY plane (width, height) with Z = thickness
    // Actually this is correct, just center it
    geometry.translate(0, 0, -thickness / 2);
  } else {
    // Slab: horizontal panel
    // We need XZ plane (width, depth) with Y = thickness
    // Rotate 90° on X axis to lay flat
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, thickness / 2, 0);
  }
  
  return geometry;
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
function createTriplanarMaterial(texture, layoutInfo, isBacksplash, fallbackColor, debugMode = false, opacity = 1.0) {
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
    
    void main() {
      vLocalPosition = position;
      // Use LOCAL normal directly, not transformed by normalMatrix
      // This ensures face detection works regardless of camera angle
      vLocalNormal = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  
  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform vec2 uPieceOffset;
    uniform vec2 uPieceScale;
    uniform vec2 uPieceSize;
    uniform bool uIsBacksplash;
    uniform bool uIsRotatedOnTile;
    uniform vec3 uSideColor;
    uniform bool uDebugMode;
    uniform float uOpacity;
    
    varying vec3 vLocalPosition;
    varying vec3 vLocalNormal;
    
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
            gl_FragColor = vec4(texColor.rgb, 0.9);
          }
        } else {
          vec4 texColor = texture2D(uTexture, tileUV);
          gl_FragColor = vec4(texColor.rgb, uOpacity);
        }
      } else {
        // Sides and back: solid color
        gl_FragColor = vec4(uSideColor, uOpacity);
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
function computeLayout(elements, library) {
  const pieces = [];
  const tiles = [];
  const piecesByKey = {};
  
  if (!elements || elements.length === 0) {
    return { pieces, tiles, piecesByKey };
  }
  
  // Step 1: Separate slab+waterfall sets from standalone pieces
  const slabSets = [];
  const standalonePieces = [];
  
  elements.forEach(el => {
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
    
    // Helper: create new tile
    const createTile = () => {
      const idx = groupTiles.length;
      groupTiles.push({ 
        spaces: [{ x: 0, y: 0, w: TW, h: TH }],
        colorId,
        thickness,
        format
      });
      return idx;
    };
    
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
  
  return { pieces, tiles, piecesByKey };
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
        .select('name, is_admin')
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
            e-blat<span style={{ color: '#c9a962' }}>.ro</span>
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
        setProjects(data || []);
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
      // Fallback
      const localDuplicate = {
        ...duplicate,
        id: Date.now().toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setProjects([localDuplicate, ...projects]);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', fontFamily: 'system-ui', color: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '20px', fontWeight: 300 }}>
          e-blat<span style={{ color: '#c9a962' }}>.ro</span>
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
                    <button onClick={() => duplicateProject(project)} style={{ ...secondaryBtnStyle, padding: '8px', fontSize: '12px' }}>📋</button>
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
            <span style={{ fontSize: '18px' }}>e-blat<span style={{ color: '#c9a962' }}>.ro</span></span>
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
  const [saveStatus, setSaveStatus] = useState(null);
  const [snapIndicators, setSnapIndicators] = useState([]); // [{x, z, type}]
  const [texturePreview, setTexturePreview] = useState(null); // { texture: url, name: string }
  const [texturePreviewVisible, setTexturePreviewVisible] = useState(false); // pentru animație fade
  const [materialWarnings, setMaterialWarnings] = useState([]); // Warnings for archived/missing materials
  const [debugTexture, setDebugTexture] = useState(false); // Debug mode: show full texture with transparency
  
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
          };
          setLibrary(loadedLibrary);
          
          // Validate materials in project elements
          if (project?.elements?.length > 0) {
            const warnings = [];
            project.elements.forEach(el => {
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
          const newHistory = [...history, prev];
          // Limit history size
          if (newHistory.length > MAX_UNDO_HISTORY) {
            return newHistory.slice(-MAX_UNDO_HISTORY);
          }
          return newHistory;
        });
      }
      return nextElements;
    });
  }, []);
  
  // Undo function
  const undo = useCallback(() => {
    if (undoHistory.length === 0) return;
    
    const previousState = undoHistory[undoHistory.length - 1];
    setUndoHistory(history => history.slice(0, -1));
    setElementsInternal(previousState);
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
        // Try saving with groups first
        let { error } = await supabase
          .from('projects')
          .update({ 
            elements,
            groups,
            updated_at: new Date().toISOString() 
          })
          .eq('id', project.id);
        
        // If groups column doesn't exist, save without it
        if (error?.code === 'PGRST204') {
          const result = await supabase
            .from('projects')
            .update({ 
              elements,
              updated_at: new Date().toISOString() 
            })
            .eq('id', project.id);
          error = result.error;
        }
        
        if (error) throw error;
        setSaveStatus('saved');
      } catch (err) {
        console.error('Error saving project:', err);
        // Fallback to localStorage
        const updatedProject = { ...project, elements, groups, updated_at: new Date().toISOString() };
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
  }, [elements, groups, project, user]);

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
          const SNAP_THRESHOLD = 0.10;
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
            
            // Member's 5 snap points
            const memberPoints = [
              { x: memberWorldX - memberW / 2, z: memberWorldZ - memberD / 2 },
              { x: memberWorldX + memberW / 2, z: memberWorldZ - memberD / 2 },
              { x: memberWorldX - memberW / 2, z: memberWorldZ + memberD / 2 },
              { x: memberWorldX + memberW / 2, z: memberWorldZ + memberD / 2 },
              { x: memberWorldX, z: memberWorldZ - memberD / 2 }, // Front-center
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
              
              // Other's 5 snap points
              const otherPoints = [
                { x: otherPos.x - otherW / 2, z: otherPos.z - otherD / 2 },
                { x: otherPos.x + otherW / 2, z: otherPos.z - otherD / 2 },
                { x: otherPos.x - otherW / 2, z: otherPos.z + otherD / 2 },
                { x: otherPos.x + otherW / 2, z: otherPos.z + otherD / 2 },
                { x: otherPos.x, z: otherPos.z - otherD / 2 },
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
            const SNAP_THRESHOLD = 0.10;
            const snapIndicators = [];
            
            // Get dimensions of moving element
            const elRotation = (pending.rotation || 0) % 360;
            const isRotated90 = Math.abs(elRotation % 180 - 90) < 5;
            let movingWidth = el.length / 100;
            let movingDepth = el.type === 'backsplash' ? (el.thickness || 12) / 1000 : el.depth / 100;
            if (isRotated90) [movingWidth, movingDepth] = [movingDepth, movingWidth];
            
            // Moving element's 5 snap points: 4 corners + center front
            const movingY = (el.placementHeight || 0) / 100; // Height of moving element
            const movingPoints = [
              { x: newX - movingWidth / 2, z: newZ - movingDepth / 2, name: 'FL' }, // Front-Left
              { x: newX + movingWidth / 2, z: newZ - movingDepth / 2, name: 'FR' }, // Front-Right
              { x: newX - movingWidth / 2, z: newZ + movingDepth / 2, name: 'BL' }, // Back-Left
              { x: newX + movingWidth / 2, z: newZ + movingDepth / 2, name: 'BR' }, // Back-Right
              { x: newX, z: newZ - movingDepth / 2, name: 'FC' }, // Front-Center
            ];
            
            let snapX = null, snapZ = null;
            
            elements.forEach(other => {
              if (selectedIds.includes(other.id)) return;
              
              const otherPos = getWorldPosDuringDrag(other);
              const otherRot = (pendingElementTransforms[other.id]?.rotation ?? other.rotation ?? 0) % 360;
              const otherIsRotated90 = Math.abs(otherRot % 180 - 90) < 5;
              
              let otherWidth = other.length / 100;
              let otherDepth = other.type === 'backsplash' ? (other.thickness || 12) / 1000 : other.depth / 100;
              if (otherIsRotated90) [otherWidth, otherDepth] = [otherDepth, otherWidth];
              
              // Other element's 5 snap points
              const otherY = (other.placementHeight || 0) / 100;
              const otherPoints = [
                { x: otherPos.x - otherWidth / 2, z: otherPos.z - otherDepth / 2, name: 'FL' },
                { x: otherPos.x + otherWidth / 2, z: otherPos.z - otherDepth / 2, name: 'FR' },
                { x: otherPos.x - otherWidth / 2, z: otherPos.z + otherDepth / 2, name: 'BL' },
                { x: otherPos.x + otherWidth / 2, z: otherPos.z + otherDepth / 2, name: 'BR' },
                { x: otherPos.x, z: otherPos.z - otherDepth / 2, name: 'FC' },
              ];
              
              // Determine snap type based on height difference
              const heightDiff = Math.abs(movingY - otherY);
              const snapType = heightDiff > 0.01 ? 'warning' : 'element'; // Red if different heights
              const indicatorY = movingY; // Use height of element being dragged
              
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
            
            // Grid snap (if no element snap found) - use blue color
            // Priority: 60cm (kitchen module) > 10cm (fine grid)
            const GRID_60 = 0.6; // 60cm - kitchen module
            const GRID_10 = 0.1; // 10cm - fine grid
            const indicatorY = (el.placementHeight || 0) / 100;
            
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
        // Multiple ungrouped elements - rotate around center
        const selectedEls = elements.filter(e => selectedIds.includes(e.id) && !e.groupId);
        if (selectedEls.length === 0) return;
        
        const centerX = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).x, 0) / selectedEls.length;
        const centerZ = selectedEls.reduce((sum, e) => sum + getWorldPosDuringDrag(e).z, 0) / selectedEls.length;
        
        const angleRad = angleDelta * Math.PI / 180;
        
        selectedEls.forEach(el => {
          const mesh = meshesRef.current[el.id];
          if (!mesh) return;
          
          const pending = pendingElementTransforms[el.id] || { 
            position: { ...(el.position || { x: 0, z: 0 }) }, 
            rotation: el.rotation || 0 
          };
          
          // Rotate position around center
          const px = pending.position.x - centerX;
          const pz = pending.position.z - centerZ;
          const newX = px * Math.cos(angleRad) - pz * Math.sin(angleRad) + centerX;
          const newZ = px * Math.sin(angleRad) + pz * Math.cos(angleRad) + centerZ;
          
          const baseRot = rawRotations[el.id] ?? pending.rotation;
          let newRot = baseRot + angleDelta;
          rawRotations[el.id] = newRot;
          
          if (snapEnabled) {
            newRot = Math.round(newRot / 5) * 5;
          }
          
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
      
      // Commit group transforms
      if (Object.keys(pendingGroupTransforms).length > 0) {
        hasChanges = true;
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
      isDraggingRef.current = false; // Allow useEffect to update positions again
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

    // Lights - flat shading with only ambient for clear texture visibility
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

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
      
      // Middle mouse button (button 1) - orbit or pan
      if (e.button === 1) {
        e.preventDefault();
        if (e.shiftKey) {
          isDraggingPan = true;
        } else {
          isDraggingOrbit = true;
        }
        return;
      }
      
      // Right mouse button (button 2) - orbit (touchpad friendly)
      if (e.button === 2) {
        e.preventDefault();
        if (e.shiftKey) {
          isDraggingPan = true;
        } else {
          isDraggingOrbit = true;
        }
        return;
      }
      
      // Left click - element interaction
      if (e.button === 0) {
        // Alt + left click = orbit (touchpad friendly alternative)
        if (e.altKey) {
          e.preventDefault();
          if (e.shiftKey) {
            isDraggingPan = true;
          } else {
            isDraggingOrbit = true;
          }
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
          // Clicked on empty space - deselect all in select mode
          const currentTool = window.getCurrentTool?.() || 'select';
          if (currentTool === 'select' && !e.ctrlKey && !e.metaKey) {
            window.deselectAll?.();
          }
        }
      }
    };

    const handleMouseUp = () => {
      // Commit any pending position/rotation changes to React state
      if (isDraggingElement || isRotatingElement) {
        window.commitElementChanges?.();
      }
      // Clear snap indicators
      window.clearSnapIndicators?.();
      // Clear duplicate flag
      window._pendingDuplicate = false;
      
      isDraggingOrbit = false;
      isDraggingPan = false;
      isDraggingElement = false;
      isRotatingElement = false;
      draggedElementId = null;
      dragStartPos = null;
    };

    const handleMouseMove = (e) => {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      
      if (isDraggingOrbit) {
        orbitRef.current.theta += dx * 0.005;  // Reversed direction, slower
        orbitRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbitRef.current.phi - dy * 0.005));  // Reversed Y
        prevMouse = { x: e.clientX, y: e.clientY };
        updateCamera();
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
      
      // Detect if this is likely a touchpad (has both deltaX and deltaY, or ctrlKey for pinch)
      const isTouchpad = Math.abs(e.deltaX) > 0 || e.ctrlKey;
      
      if (e.ctrlKey) {
        // Pinch to zoom on touchpad (ctrlKey is set during pinch gesture)
        orbitRef.current.radius = Math.max(2, Math.min(20, orbitRef.current.radius + e.deltaY * 0.02));
        updateCamera();
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
        // Regular mouse wheel - zoom
        orbitRef.current.radius = Math.max(2, Math.min(20, orbitRef.current.radius + e.deltaY * 0.01));
        updateCamera();
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
  const layoutData = useMemo(() => computeLayout(elements, library), [elements, library]);
  const pieceLayout = layoutData.piecesByKey;

  // Track previous element properties to detect what changed
  const prevElementsRef = useRef({});
  
  // Helper to get geometry-affecting properties (excluding position/rotation)
  const getGeometryHash = (el) => {
    return JSON.stringify({
      type: el.type,
      length: el.length,
      depth: el.depth,
      height: el.height,
      thickness: el.thickness,
      material: el.material,
      placementHeight: el.placementHeight,
      waterfallLeft: el.waterfallLeft,
      waterfallRight: el.waterfallRight,
      waterfallHeight: el.waterfallHeight,
      grainLengthwise: el.grainLengthwise,
      cutouts: el.cutouts, // Include cutouts in hash for change detection
    });
  };

  // Update 3D meshes when elements change
  useEffect(() => {
    if (!sceneRef.current) return;

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
      
      // If only position/rotation changed, just update the mesh transform
      // But skip if we're dragging - the drag handlers update positions directly
      if (!isNew && !geometryChanged && !selectionChanged && !groupIdChanged && !debugModeChanged && meshesRef.current[el.id]) {
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
      // If only selection or groupId changed and NO waterfall, update outline without recreating
      if (!isNew && !geometryChanged && !debugModeChanged && (selectionChanged || groupIdChanged) && !hasWaterfall && meshesRef.current[el.id]) {
        const mesh = meshesRef.current[el.id];
        
        // Remove existing outlines AND debug tile helpers from mesh
        const toRemove = [];
        mesh.traverse((child) => {
          if (child.isLineSegments || child.userData?.isDebugTileHelper) {
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
              const textureLoader = new THREE.TextureLoader();
              textureLoader.load(colorData.texture, (texture) => {
                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.anisotropy = rendererRef.current?.capabilities?.getMaxAnisotropy() || 4;
                const triplanarMat = createTriplanarMaterial(texture, layoutInfo, isBacksplash, color, false);
                mesh.material.dispose();
                mesh.material = triplanarMat;
              });
            } else {
              mesh.material.dispose();
              mesh.material = new THREE.MeshBasicMaterial({ color: color });
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
          
          // Add debug tile helper if debug mode is active
          const isDebugActive = debugTexture && shouldHighlight;
          const layoutInfo = layout[`${el.id}_main`];
          const colorData = library.colors.find(c => c.id === el.material) || { color: '#666666' };
          
          if (isDebugActive && layoutInfo && colorData.texture) {
            const tileW = layoutInfo.tileW / 100;
            const tileH = layoutInfo.tileH / 100;
            const pieceX = layoutInfo.x / 100;
            const pieceY = layoutInfo.y / 100;
            const pieceW = layoutInfo.pieceW / 100;
            const pieceH = layoutInfo.pieceH / 100;
            const isRotatedOnTile = layoutInfo.grainLengthwise === false;
            const isBacksplash = el.type === 'backsplash';
            
            const tileCenterX = tileW / 2;
            const tileCenterY = tileH / 2;
            const pieceCenterOnTileX = pieceX + pieceW / 2;
            const pieceCenterOnTileY = pieceY + pieceH / 2;
            
            let offsetPackerX = tileCenterX - pieceCenterOnTileX;
            let offsetPackerY = tileCenterY - pieceCenterOnTileY;
            
            let offset3dX, offset3dZ;
            if (isRotatedOnTile) {
              offset3dX = -offsetPackerY;
              offset3dZ = offsetPackerX;
            } else {
              offset3dX = offsetPackerX;
              offset3dZ = offsetPackerY;
            }
            
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
            
            const fullTileLayoutInfo = {
              x: 0, y: 0,
              w: isRotatedOnTile ? layoutInfo.tileH : layoutInfo.tileW,
              h: isRotatedOnTile ? layoutInfo.tileW : layoutInfo.tileH,
              pieceW: layoutInfo.tileW, pieceH: layoutInfo.tileH,
              tileW: layoutInfo.tileW, tileH: layoutInfo.tileH,
              grainLengthwise: !isRotatedOnTile
            };
            
            const color = new THREE.Color(colorData.color);
            const tileMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5 });
            const tileMesh = new THREE.Mesh(tileGeo, tileMat);
            tileMesh.renderOrder = -1;
            
            // Position in LOCAL space (as child of mesh)
            if (isBacksplash) {
              tileMesh.position.set(offset3dX, -offset3dZ, -0.005);
            } else {
              tileMesh.position.set(offset3dX, -0.005, offset3dZ);
            }
            
            // Ensure tile helper has no local rotation
            tileMesh.rotation.set(0, 0, 0);
            
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(colorData.texture, (texture) => {
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              const tileTriplanarMat = createTriplanarMaterial(texture, fullTileLayoutInfo, isBacksplash, color, false, 0.5);
              tileMesh.material.dispose();
              tileMesh.material = tileTriplanarMat;
              if (rendererRef.current && sceneRef.current && cameraRef.current) {
                rendererRef.current.render(sceneRef.current, cameraRef.current);
              }
            });
            
            const tileEdges = new THREE.EdgesGeometry(tileGeo);
            const tileLineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2, depthTest: false });
            const tileOutline = new THREE.LineSegments(tileEdges, tileLineMat);
            tileOutline.renderOrder = 999;
            tileMesh.add(tileOutline);
            
            tileMesh.userData.isDebugTileHelper = true;
            mesh.add(tileMesh);  // Add as child of mesh
          }
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

      const colorData = library.colors.find(c => c.id === el.material) || { color: '#666666' };
      const color = new THREE.Color(colorData.color);

      const width = el.length / 100;
      const thicknessCm = (el.thickness || 12) / 1000;
      const placementHeight = (el.placementHeight || 0) / 100;
      
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
        // Load texture and create triplanar shader material
        const textureLoader = new THREE.TextureLoader();
        const isBacksplash = el.type === 'backsplash';
        
        // Create placeholder material first
        material = new THREE.MeshBasicMaterial({ color: color });
        
        textureLoader.load(colorData.texture, (texture) => {
          // Configure texture
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.anisotropy = rendererRef.current?.capabilities?.getMaxAnisotropy() || 4;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          
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
            mesh.material = transparentMat;
          } else {
            const triplanarMat = createTriplanarMaterial(texture, layoutInfo, isBacksplash, color, false);
            mesh.material = triplanarMat;
          }
          mesh.material.needsUpdate = true;
        });
      } else {
        material = new THREE.MeshBasicMaterial({ color: color });
      }
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

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
          
          const mat = new THREE.MeshBasicMaterial({
            color: wfHasTexture ? 0xffffff : color,
          });
          
          // For selection highlight, we'll tint the color directly since MeshBasicMaterial has no emissive
          if (isSelectedElement) {
            mat.color = new THREE.Color(highlightColor);
            mat.transparent = true;
            mat.opacity = 0.7;
          }
          
          if (wfHasTexture) {
            // For waterfall, we need to manually set UV coordinates on the side faces
            // because the piece is laid out horizontally in packer but rendered vertically in 3D
            //
            // Packer layout: pieceW=90 (waterfall height) horizontal, pieceH=60 (depth) vertical
            // 3D geometry: BoxGeometry(thickness, waterfallHeight=90, depth=60)
            //   - Side face (+X/-X): Y axis = 90cm vertical, Z axis = 60cm horizontal
            //
            // We need to sample the texture region correctly:
            // - In packer, the region is at (x, y) with size (pieceW, pieceH) = (90, 60)
            // - On 3D face: mesh Z (horizontal, 0-60cm) should map to pieceH direction
            //               mesh Y (vertical, 0-90cm) should map to pieceW direction
            
            const { x, y, pieceW, pieceH, tileW, tileH } = wfLayout;
            
            // Modify UV coordinates for side faces
            const uvAttr = waterfallGeo.attributes.uv;
            const uvArray = uvAttr.array;
            
            // UV bounds for the texture region
            // The piece occupies (x, y) to (x+pieceW, y+pieceH) on tile
            // Texture UV: U horizontal (0-1), V vertical (0=bottom, 1=top)
            const uMin = x / tileW;
            const uMax = (x + pieceW) / tileW;
            const vMin = 1 - (y + pieceH) / tileH;  // bottom in UV coords
            const vMax = 1 - y / tileH;              // top in UV coords
            
            // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
            // Each face has 4 vertices = 8 UV values (4 pairs)
            //
            // For +X face (looking from +X toward origin):
            // Vertices are at corners: we see Y (vertical) and Z (horizontal)
            // Three.js BoxGeometry +X face vertex order:
            //   0: top-front    (Y+, Z+)
            //   1: top-back     (Y+, Z-)  
            //   2: bottom-front (Y-, Z+)
            //   3: bottom-back  (Y-, Z-)
            //
            // We want:
            // - Z- (back, mesh Z=0) → left of texture region → U = uMin
            // - Z+ (front, mesh Z=depth) → right of texture region → U = uMax (but pieceH maps to Z)
            // - Y- (bottom) → bottom of region → V = vMin
            // - Y+ (top) → top of region → V = vMax (but pieceW maps to Y, and pieceW > pieceH)
            //
            // Since pieceW (90) is horizontal in packer but vertical on face (Y axis),
            // and pieceH (60) is vertical in packer but horizontal on face (Z axis):
            // - mesh Y (0 to 90) samples from uMin to uMax (horizontal extent of piece in packer)
            // - mesh Z (0 to 60) samples from vMin to vMax (vertical extent of piece in packer)
            
            // +X face (indices 0-7)
            uvArray[0] = uMax; uvArray[1] = vMax;   // Y+, Z+ (top-front) → right-top
            uvArray[2] = uMax; uvArray[3] = vMin;   // Y+, Z- (top-back) → right-bottom
            uvArray[4] = uMin; uvArray[5] = vMax;   // Y-, Z+ (bottom-front) → left-top
            uvArray[6] = uMin; uvArray[7] = vMin;   // Y-, Z- (bottom-back) → left-bottom
            
            // -X face (indices 8-15) - mirrored view
            uvArray[8] = uMax;  uvArray[9] = vMin;   // Y+, Z- → right-bottom
            uvArray[10] = uMax; uvArray[11] = vMax;  // Y+, Z+ → right-top
            uvArray[12] = uMin; uvArray[13] = vMin;  // Y-, Z- → left-bottom
            uvArray[14] = uMin; uvArray[15] = vMax;  // Y-, Z+ → left-top
            
            uvAttr.needsUpdate = true;
            
            // Load texture without rotation (UVs handle the mapping)
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(colorData.texture, (texture) => {
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              texture.anisotropy = rendererRef.current?.capabilities?.getMaxAnisotropy() || 4;
              texture.minFilter = THREE.LinearMipmapLinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.generateMipmaps = true;
              
              mat.map = texture;
              mat.needsUpdate = true;
            });
          }
          
          const mesh = new THREE.Mesh(waterfallGeo, mat);
          
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

      sceneRef.current.add(mesh);
      meshesRef.current[el.id] = mesh;
      
      // DEBUG MODE: Create a helper mesh showing the FULL TILE at real scale
      // Only for SELECTED elements to avoid visual clutter
      const isDebugActive = debugTexture && shouldHighlight;
      if (isDebugActive && layoutInfo && colorData.texture) {
        const tileW = layoutInfo.tileW / 100; // tile width in meters
        const tileH = layoutInfo.tileH / 100; // tile height in meters
        
        // Piece dimensions in meters (original, before rotation)
        const meshW = layoutInfo.w / 100;  // piece mesh width (X axis)
        const meshH = layoutInfo.h / 100;  // piece mesh depth (Z axis for slab, Y for backsplash)
        
        // Piece position on tile in packer coordinates (in meters)
        const pieceX = layoutInfo.x / 100;
        const pieceY = layoutInfo.y / 100;
        const pieceW = layoutInfo.pieceW / 100;  // width on tile (may differ from meshW if rotated)
        const pieceH = layoutInfo.pieceH / 100;  // height on tile (may differ from meshH if rotated)
        
        const isRotatedOnTile = layoutInfo.grainLengthwise === false;
        const isBacksplash = el.type === 'backsplash';
        
        // The piece mesh is centered at origin in local space
        // The tile helper needs to be positioned so that:
        // - The tile's texture (full 320x160) aligns with the piece's texture region
        //
        // In local space of the piece:
        // - Piece center is at (0, 0, 0)
        // - For slab: X is length, Z is depth
        // - Tile helper has same orientation
        //
        // We need to find where tile center should be relative to piece center
        // 
        // On the tile (packer coords, origin top-left):
        // - Piece occupies from (pieceX, pieceY) to (pieceX+pieceW, pieceY+pieceH)
        // - Piece center on tile: (pieceX + pieceW/2, pieceY + pieceH/2)
        // - Tile center: (tileW/2, tileH/2)
        //
        // Offset from piece center to tile center (in tile/packer coordinates):
        // - deltaX = tileW/2 - (pieceX + pieceW/2)
        // - deltaY = tileH/2 - (pieceY + pieceH/2)
        //
        // But we need to map this to 3D local space:
        // - Packer X -> 3D X (same direction)
        // - Packer Y -> 3D Z for slab, but Y increases DOWN in packer, Z increases "forward" in 3D
        
        const tileCenterX = tileW / 2;
        const tileCenterY = tileH / 2;
        const pieceCenterOnTileX = pieceX + pieceW / 2;
        const pieceCenterOnTileY = pieceY + pieceH / 2;
        
        // Offset from piece center to tile center (in packer/tile coordinates)
        const offsetTileX = tileCenterX - pieceCenterOnTileX;
        const offsetTileY = tileCenterY - pieceCenterOnTileY;
        
        // For tile helper, we'll add it to SCENE (not mesh) and position in world space
        // This avoids issues with piece rotation affecting the helper
        // Get piece world position
        const pieceWorldPos = new THREE.Vector3();
        mesh.getWorldPosition(pieceWorldPos);
        
        // Calculate tile center world position
        // Tile coordinates: X is horizontal, Y is vertical (top-down view)
        // 3D world for slab: X is horizontal, Z is depth (front-back)
        // For non-rotated: tile X -> world X, tile Y -> world Z
        // For rotated: the piece is rotated 90°, but tile helper should still show full tile in world orientation
        
        // Create tile geometry - use BoxGeometry like pieces for consistent normals
        // Tile helper should show the FULL tile texture at correct position
        // It's a child of the piece mesh, so it inherits piece rotation
        let tileGeo;
        if (isBacksplash) {
          // Thin box for backsplash (X=width, Y=height, Z=thickness)
          tileGeo = new THREE.BoxGeometry(tileW, tileH, 0.01);
        } else {
          // Thin box for slab (X=width, Y=thickness, Z=depth)
          // Use 0.01m thickness for better normal detection
          if (isRotatedOnTile) {
            // When piece is rotated, swap tile dimensions for helper
            tileGeo = new THREE.BoxGeometry(tileH, 0.01, tileW);
          } else {
            tileGeo = new THREE.BoxGeometry(tileW, 0.01, tileH);
          }
        }
        
        // Create layout info for the FULL TILE (offset 0, scale 1)
        // Match the piece's rotation state so shader applies same UV transform
        const fullTileLayoutInfo = {
          x: 0,
          y: 0,
          w: isRotatedOnTile ? layoutInfo.tileH : layoutInfo.tileW,  // Swap if rotated
          h: isRotatedOnTile ? layoutInfo.tileW : layoutInfo.tileH,  // Swap if rotated
          pieceW: layoutInfo.tileW,
          pieceH: layoutInfo.tileH,
          tileW: layoutInfo.tileW,
          tileH: layoutInfo.tileH,
          grainLengthwise: !isRotatedOnTile  // Match piece rotation
        };
        
        // Load texture and create material using same shader
        const textureLoader = new THREE.TextureLoader();
        const tileMat = new THREE.MeshBasicMaterial({ 
          color: color,
          transparent: true,
          opacity: 0.5
        });
        
        // Create mesh FIRST so it's available in the texture load callback
        const tileMesh = new THREE.Mesh(tileGeo, tileMat);
        tileMesh.renderOrder = -1;
        
        // Position tile helper in LOCAL space of the piece (as child of mesh)
        // This way it automatically inherits piece rotation
        //
        // Offset calculation:
        // - Piece center is at local (0, 0, 0)
        // - Tile center needs to be offset so piece aligns with its region on tile
        // - offsetTileX = tileCenterX - pieceCenterOnTileX (positive = tile center is to the RIGHT of piece center)
        // - offsetTileY = tileCenterY - pieceCenterOnTileY (positive = tile center is BELOW piece center in packer coords)
        //
        // Mapping to 3D local space:
        // - Packer X -> Local X (same direction, positive = right)
        // - Packer Y -> Local Z for slab (positive packer Y = "down" = positive local Z = "forward")
        // - Packer Y -> Local -Y for backsplash (positive packer Y = "down" = negative local Y = "down")
        
        if (isBacksplash) {
          // Backsplash: local X = width, local Y = height, local Z = thickness
          // Packer Y (down) maps to local -Y (down)
          tileMesh.position.set(offsetTileX, -offsetTileY, -0.005);
        } else {
          // Slab: local X = length, local Y = thickness, local Z = depth
          // Packer Y (down) maps to local Z (forward)
          tileMesh.position.set(offsetTileX, -0.005, offsetTileY);
        }
        
        // Ensure tile helper has no local rotation (inherits parent rotation only)
        tileMesh.rotation.set(0, 0, 0);
        
        // Add as CHILD of mesh - inherits rotation automatically
        mesh.add(tileMesh);
        
        // Store reference for cleanup
        tileMesh.userData.isDebugTileHelper = true;
        tileMesh.userData.parentElementId = el.id;
        
        textureLoader.load(colorData.texture, (texture) => {
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.anisotropy = rendererRef.current?.capabilities?.getMaxAnisotropy() || 4;
          
          // Use same triplanar material as pieces, but for full tile with 50% opacity
          const tileTriplanarMat = createTriplanarMaterial(texture, fullTileLayoutInfo, isBacksplash, color, false, 0.5);
          
          tileMesh.material.dispose(); // Clean up old material
          tileMesh.material = tileTriplanarMat;
          
          // Force a re-render
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
        });
        
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
    });
    prevElementsRef.current = newPrevElements;
    
    // Update debug texture ref for next comparison
    prevDebugTextureRef.current = debugTexture;
  }, [elements, selectedIds, library, pieceLayout, groups, debugTexture]);

  // Helper functions
  const getColorById = (id) => library.colors.find(c => c.id === id) || { id: id, name: 'Material necunoscut', color: '#666666' };
  const getManufacturerForColor = (colorId) => {
    const color = library.colors.find(c => c.id === colorId);
    return color?.manufacturer || library.manufacturers[0]?.id;
  };

  const getThicknessesForColor = (colorId) => {
    return [...new Set(library.formats.filter(f => f.colorId === colorId).map(f => f.thickness))].sort((a, b) => a - b);
  };

  const addElement = (type) => {
    const firstColor = library.colors[0];
    const thicknesses = getThicknessesForColor(firstColor?.id);
    
    // For blat (island type), prefer 12mm if available
    let defaultThickness;
    if (type === 'backsplash') {
      defaultThickness = thicknesses[0] || 12;
    } else {
      // Prefer 12mm for blat if available, otherwise use first available
      defaultThickness = thicknesses.includes(12) ? 12 : (thicknesses[0] || 12);
    }

    const el = {
      id: generateId(),
      type,
      name: type === 'backsplash' ? 'Contrablat' : 'Blat',
      length: type === 'backsplash' ? 200 : 200,
      depth: type === 'backsplash' ? 2 : 60,
      height: type === 'backsplash' ? 60 : 90,
      placementHeight: type === 'backsplash' ? 90 : 90,
      thickness: defaultThickness,
      material: firstColor?.id,
      waterfallLeft: false,
      waterfallRight: false,
      position: { x: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 },
      rotation: 0,
    };

    setElements([...elements, el]);
    setSelectedId(el.id);
  };

  const updateElement = (id, updates) => {
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
      // Single select
      setSelectedIds([id]);
    }
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
      name: `${el.name} (copie)`,
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
  
  const copySelected = () => {
    if (selectedIds.length === 0) return;
    
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
  };
  
  const pasteClipboard = () => {
    if (!clipboard || clipboard.length === 0) return;
    
    const newElements = clipboard.map(el => ({
      ...el,
      id: generateId(),
      name: `${el.name} (copie)`,
      position: { 
        x: (el.position?.x || 0) + 0.3, 
        z: (el.position?.z || 0) + 0.3 
      },
      // Regenerate cutout IDs to avoid duplicates
      cutouts: el.cutouts?.map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) }))
    }));
    
    setElements([...elements, ...newElements]);
    setSelectedIds(newElements.map(el => el.id));
  };

  const selected = elements.find(el => el.id === selectedId);
  const selectedColor = selected ? getColorById(selected.material) : null;
  const selectedManufacturer = selected ? getManufacturerForColor(selected.material) : null;
  const availableThicknesses = selected ? getThicknessesForColor(selected.material) : [];

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
  }, [selectedIds, snapEnabled, elements]);

  const toolBtnStyle = (active) => ({
    padding: '6px 12px',
    background: active ? 'rgba(201,169,98,0.2)' : '#1a1a1a',
    border: active ? '1px solid #c9a962' : '1px solid #2a2a2a',
    color: active ? '#c9a962' : '#888',
    cursor: 'pointer',
    fontSize: '11px',
    borderRadius: '4px',
  });

  return (
    <div style={{ height: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}>← Proiecte</button>
          <div>
            <span style={{ fontSize: '16px' }}>e-blat<span style={{ color: '#c9a962' }}>.ro</span></span>
            <span style={{ color: '#666', fontSize: '13px', marginLeft: '8px' }}>/ {project.name}</span>
          </div>
          {saveStatus && <span style={{ fontSize: '10px', color: '#4a9', marginLeft: '8px' }}>✓ Salvat</span>}
          <div style={{ width: '1px', height: '20px', background: '#333' }} />
          <button 
            onClick={() => setDebugTexture(!debugTexture)} 
            style={{ 
              ...toolBtnStyle(debugTexture), 
              background: debugTexture ? 'rgba(147,112,219,0.2)' : '#1a1a1a', 
              borderColor: debugTexture ? '#9370db' : '#2a2a2a', 
              color: debugTexture ? '#9370db' : '#666',
              fontSize: '11px',
              padding: '4px 8px'
            }}
            title="Afișează textura completă pe piese (pentru debug UV mapping)"
          >
            🔍 Debug Textură {debugTexture ? 'ON' : 'OFF'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => setTool('select')} style={toolBtnStyle(tool === 'select')}>↖ Select</button>
            <button onClick={() => setTool('move')} style={toolBtnStyle(tool === 'move')}>✥ Move</button>
            <button onClick={() => setTool('rotate')} style={toolBtnStyle(tool === 'rotate')}>↻ Rotate</button>
          </div>
          <div style={{ width: '1px', height: '20px', background: '#333' }} />
          <button 
            onClick={groupSelected} 
            disabled={selectedIds.length < 2}
            style={{ 
              ...toolBtnStyle(false), 
              opacity: selectedIds.length < 2 ? 0.4 : 1,
              cursor: selectedIds.length < 2 ? 'not-allowed' : 'pointer'
            }}
            title="Group (Ctrl+G)"
          >
            ⊞ Group
          </button>
          <button 
            onClick={ungroupSelected} 
            disabled={!elements.some(el => selectedIds.includes(el.id) && el.groupId)}
            style={{ 
              ...toolBtnStyle(false), 
              opacity: !elements.some(el => selectedIds.includes(el.id) && el.groupId) ? 0.4 : 1,
              cursor: !elements.some(el => selectedIds.includes(el.id) && el.groupId) ? 'not-allowed' : 'pointer'
            }}
            title="Ungroup (Ctrl+X)"
          >
            ⊟ Ungroup
          </button>
          <div style={{ width: '1px', height: '20px', background: '#333' }} />
          <button onClick={() => setSnapEnabled(!snapEnabled)} style={{ ...toolBtnStyle(snapEnabled), background: snapEnabled ? 'rgba(74,153,74,0.2)' : '#1a1a1a', borderColor: snapEnabled ? '#4a9' : '#2a2a2a', color: snapEnabled ? '#4a9' : '#666' }}>
            ⊞ Snap {snapEnabled ? 'ON' : 'OFF'}
          </button>
          <button 
            onClick={undo} 
            disabled={undoHistory.length === 0}
            style={{ 
              ...toolBtnStyle(false), 
              opacity: undoHistory.length === 0 ? 0.4 : 1,
              cursor: undoHistory.length === 0 ? 'not-allowed' : 'pointer'
            }}
            title="Undo (Ctrl+Z)"
          >
            ↩ Undo
          </button>
        </div>

        <div style={{ fontSize: '10px', color: '#555' }}>G=Move R=Rotate D=Dup Del=Șterge | Ctrl+Click=Adaugă Shift+Click=Elimină | Ctrl+G=Group Ctrl+X=Ungroup</div>
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
              <button onClick={() => addElement('island')} style={{ padding: '8px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', cursor: 'pointer', fontSize: '11px', textAlign: 'left', borderRadius: '4px' }}>+ Blat</button>
              <button onClick={() => addElement('backsplash')} style={{ padding: '8px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', cursor: 'pointer', fontSize: '11px', textAlign: 'left', borderRadius: '4px' }}>+ Contrablat</button>
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
              
              return (
                <div
                  key={el.id}
                  onClick={(e) => handleElementSelect(el.id, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey })}
                  style={{
                    padding: '10px',
                    marginBottom: '6px',
                    cursor: 'pointer',
                    background: isSelected ? (groupColorData ? `hsla(${groupColorData.hue}, 60%, 50%, 0.15)` : 'rgba(201,169,98,0.15)') : '#1a1a1a',
                    border: `2px solid ${isSelected ? (groupColor || '#c9a962') : '#2a2a2a'}`,
                    borderRadius: '4px',
                    borderLeft: hasGroup ? `4px solid ${groupColor}` : (hasExceedingPiece ? '4px solid #c96262' : undefined),
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
                      </div>
                      <div style={{ fontSize: '10px', color: hasExceedingPiece ? '#c96262' : '#666' }}>{el.length}×{el.type === 'backsplash' ? el.height : el.depth}cm • {el.thickness}mm</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                        <div style={{ width: '12px', height: '12px', background: getColorById(el.material)?.color, borderRadius: '2px', border: '1px solid #333' }} />
                        <span style={{ fontSize: '10px', color: '#888' }}>{getColorById(el.material)?.name}</span>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeElement(el.id); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center - 3D View */}
        <div style={{ flex: 1, position: 'relative', background: '#111', minWidth: 0 }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          {elements.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', pointerEvents: 'none' }}>
              Adaugă un element pentru a începe
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', fontSize: '10px', color: '#555', background: 'rgba(0,0,0,0.7)', padding: '6px 12px', borderRadius: '4px' }}>
            {tool === 'move' 
              ? '🖱️ Click + Drag = Mută • Right-click/Alt+Drag = Orbit • Shift = Pan • Scroll = Zoom' 
              : tool === 'rotate'
              ? '🖱️ Click + Drag = Rotește • Right-click/Alt+Drag = Orbit • Shift = Pan • Scroll = Zoom'
              : '🖱️ Click = Selectează • Right-click/Alt+Drag = Orbit • Shift = Pan • Scroll/Pinch = Zoom'}
          </div>
        </div>

        {/* Right Panel - Properties */}
        <div style={{ width: '300px', borderLeft: '1px solid #2a2a2a', overflow: 'auto', flexShrink: 0 }}>
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
              <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '10px', fontWeight: 600 }}>📐 DIMENSIUNI</div>
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
              </div>

              {/* Waterfall - only for blat type, moved here after dimensions */}
              {selected.type === 'island' && (
                <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                  <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '10px', fontWeight: 600 }}>✨ CASCADĂ (WATERFALL)</div>
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
                </div>
              )}

              {/* Material Section - Cascading selectors with gallery */}
              <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '10px', fontWeight: 600 }}>🎨 MATERIAL</div>
                
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
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '10px', fontWeight: 600 }}>📝 NOTE</div>
                <textarea 
                  value={selected.notes || ''} 
                  onChange={e => updateElement(selected.id, { notes: e.target.value })}
                  placeholder="Notițe, instrucțiuni speciale..."
                  rows={3}
                  style={{ ...inputStyle, padding: '8px', resize: 'vertical', fontSize: '11px' }} 
                />
              </div>

              {/* Cutouts Section */}
              <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '6px', border: '1px solid #2a2a2a' }}>
                <div style={{ fontSize: '10px', color: '#c9a962', marginBottom: '10px', fontWeight: 600 }}>✂️ DECUPAJE</div>
                
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
                    {(selected.cutouts || []).map((cutout, cutoutIndex) => {
                      const pieceDepth = selected.type === 'backsplash' ? selected.height : selected.depth;
                      const userInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                      const validation = validateCutout(cutout, selected.length, pieceDepth, selected.cutouts || []);
                      const preset = CUTOUT_PRESETS[cutout.preset];
                      const icon = preset?.icon || (cutout.type === 'circle' ? '⭕' : '⬜');
                      
                      return (
                        <div key={cutout.id} style={{
                          padding: '10px',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          border: `1px solid ${validation.errors.length > 0 ? '#c96262' : (validation.warnings.length > 0 ? '#c9a962' : '#2a2a2a')}`
                        }}>
                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 500 }}>
                              {icon} {cutout.name}
                            </div>
                            <button
                              onClick={() => {
                                if (window.confirm(`Ștergi decupajul "${cutout.name}"?`)) {
                                  const newCutouts = (selected.cutouts || []).filter(c => c.id !== cutout.id);
                                  updateElement(selected.id, { cutouts: newCutouts });
                                }
                              }}
                              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                            >×</button>
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
                                step={0.5}
                                style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                              />
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                              <div>
                                <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Lățime (cm)</label>
                                <NumericInput
                                  value={cutout.width || 0}
                                  onChange={v => {
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, width: v };
                                    // Recalculate center to keep corner position stable
                                    const oldUserInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                                    const newCenter = cutoutUserInputToCenter(oldUserInput.cotaStanga, oldUserInput.cotaFata, { ...cutout, width: v }, selected.length, pieceDepth);
                                    newCutouts[cutoutIndex].center = newCenter;
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={1}
                                  step={1}
                                  style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Lungime (cm)</label>
                                <NumericInput
                                  value={cutout.height || 0}
                                  onChange={v => {
                                    const newCutouts = [...(selected.cutouts || [])];
                                    newCutouts[cutoutIndex] = { ...cutout, height: v };
                                    // Recalculate center to keep corner position stable
                                    const oldUserInput = cutoutCenterToUserInput(cutout, selected.length, pieceDepth);
                                    const newCenter = cutoutUserInputToCenter(oldUserInput.cotaStanga, oldUserInput.cotaFata, { ...cutout, height: v }, selected.length, pieceDepth);
                                    newCutouts[cutoutIndex].center = newCenter;
                                    updateElement(selected.id, { cutouts: newCutouts });
                                  }}
                                  min={1}
                                  step={1}
                                  style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                                />
                              </div>
                              {cutout.type === 'rectangle' && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <label style={{ fontSize: '9px', color: '#666', display: 'block', marginBottom: '2px' }}>Colțuri rotunjite (cm)</label>
                                  <NumericInput
                                    value={cutout.cornerRadius || 0}
                                    onChange={v => {
                                      const newCutouts = [...(selected.cutouts || [])];
                                      newCutouts[cutoutIndex] = { ...cutout, cornerRadius: v };
                                      updateElement(selected.id, { cutouts: newCutouts });
                                    }}
                                    min={0}
                                    max={Math.min((cutout.width || 0) / 2, (cutout.height || 0) / 2)}
                                    step={0.5}
                                    style={{ ...inputStyle, padding: '6px', fontSize: '11px' }}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Position - User friendly (from left edge) */}
                          <div style={{ marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a' }}>
                            <label style={{ fontSize: '9px', color: '#888', display: 'block', marginBottom: '4px' }}>
                              Poziție {cutout.type === 'circle' ? '(centru)' : '(colț stânga-față)'}
                            </label>
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
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
                <button onClick={() => duplicateElement(selected.id)} style={{ ...secondaryBtnStyle, flex: 1, padding: '10px', fontSize: '11px' }}>📋 Duplică</button>
                <button onClick={() => removeElement(selected.id)} style={{ ...secondaryBtnStyle, flex: 1, padding: '10px', fontSize: '11px', color: '#c96262' }}>🗑️ Șterge</button>
              </div>
            </div>
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
      <SlabCalculatorFooter 
        elements={elements} 
        library={library} 
        selectedIds={selectedIds}
        handleElementSelect={handleElementSelect}
        project={project}
        user={user}
        canvasRef={canvasRef}
      />
    </div>
  );
}

// ============================================
// SLAB CALCULATOR FOOTER COMPONENT
// ============================================

function SlabCalculatorFooter({ elements, library, selectedIds, handleElementSelect, project, user, canvasRef }) {
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState(null); // 'success' | 'error' | null
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const footerRef = useRef(null);
  const tilesAreaRef = useRef(null);
  
  // For backward compat
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  
  const getColorById = (id) => library.colors.find(c => c.id === id) || { name: 'N/A', color: '#666' };
  
  const getMaterialType = (colorId) => {
    const color = library.colors.find(c => c.id === colorId);
    if (!color) return '';
    const manufacturer = library.manufacturers.find(m => m.id === color.manufacturer);
    return manufacturer?.materialType || '';
  };
  
  const getFormatById = (formatId) => library.formats.find(f => f.id === formatId);
  
  // Use the shared computeLayout function - SINGLE SOURCE OF TRUTH
  const { pieces: rawPieces, tiles } = useMemo(() => computeLayout(elements, library), [elements, library]);
  
  // Add sequential numbering to pieces (01, 02, 03, ...)
  const pieces = rawPieces.map((p, idx) => ({
    ...p,
    pieceNumber: String(idx + 1).padStart(2, '0'),
  }));
  
  // Early return AFTER hooks
  if (elements.length === 0) return null;
  
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
  
  // Calculate uniform scale for display
  const maxTileLength = Math.max(...tiles.map(t => t.format?.length || 320), 320);
  const maxTileWidth = Math.max(...tiles.map(t => t.format?.width || 160), 160);
  const uniformScale = 100 / maxTileWidth;
  
  // Group tiles by material type for display
  const tilesByMaterial = {};
  tiles.forEach((tile, i) => {
    const materialType = getMaterialType(tile.colorId) || 'Altele';
    if (!tilesByMaterial[materialType]) {
      tilesByMaterial[materialType] = [];
    }
    tilesByMaterial[materialType].push({ ...tile, originalIndex: i });
  });
  
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
        // Stats
        totalPieces: pieces.length,
        totalArea: parseFloat(totalArea.toFixed(2)),
        totalSlabs: count,
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
    }}>
      {/* Combined Summary Card - Compact */}
      <div style={{ 
        background: exceedingPieces.length > 0 ? 'rgba(201,98,98,0.1)' : 'rgba(201,169,98,0.1)', 
        border: exceedingPieces.length > 0 ? '1px solid #c96262' : '1px solid #c9a962', 
        padding: '8px 10px',
        minWidth: '140px',
        flexShrink: 0,
        fontSize: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', gap: '8px' }}>
          <span style={{ color: '#888' }}>Piese</span><span>{pieces.length}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', gap: '8px' }}>
          <span style={{ color: '#888' }}>Suprafață</span><span>{parseFloat(totalArea.toFixed(2))} m²</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ color: '#888' }}>Plăci</span>
          <span style={{ color: exceedingPieces.length > 0 ? '#c96262' : '#c9a962', fontWeight: 600 }}>{count}</span>
        </div>

        {/* Blaturi - inline */}
        {slabPieces.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(201,169,98,0.3)', marginTop: '4px', paddingTop: '4px' }}>
            <span style={{ color: '#c9a962', fontWeight: 600 }}>Blaturi: </span>
            {slabStandardLength > 0 && <span style={{ color: '#888' }}>{parseFloat(slabStandardLength.toFixed(2))}ml std</span>}
            {slabStandardLength > 0 && slabAtypicalLength > 0 && <span style={{ color: '#555' }}> · </span>}
            {slabAtypicalLength > 0 && <span style={{ color: '#e8a87c' }}>{parseFloat(slabAtypicalLength.toFixed(2))}ml atipic</span>}
          </div>
        )}

        {/* Contrablaturi - inline */}
        {backsplashPieces.length > 0 && (
          <div style={{ marginTop: '2px' }}>
            <span style={{ color: '#6495ed', fontWeight: 600 }}>C.blaturi: </span>
            {backsplashStandardLength > 0 && <span style={{ color: '#888' }}>{parseFloat(backsplashStandardLength.toFixed(2))}ml std</span>}
            {backsplashStandardLength > 0 && backsplashAtypicalLength > 0 && <span style={{ color: '#555' }}> · </span>}
            {backsplashAtypicalLength > 0 && <span style={{ color: '#e8a87c' }}>{parseFloat(backsplashAtypicalLength.toFixed(2))}ml atipic</span>}
          </div>
        )}

        {exceedingPieces.length > 0 && (
          <div style={{ 
            marginTop: '4px', 
            padding: '3px 6px', 
            background: 'rgba(201,98,98,0.2)', 
            borderRadius: '3px',
            fontSize: '9px',
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
                  
                  // Get pieces for this tile
                  const tilePieces = pieces.filter(p => p.tileIndex === tileIdx);
                  
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
                      <div style={{ 
                        width: tileWpx, 
                        height: tileHpx, 
                        backgroundImage: colorData.texture ? `url(${colorData.texture})` : 'none',
                        backgroundColor: colorData.texture ? 'transparent' : colorData.color,
                        backgroundSize: `${tileWpx}px ${tileHpx}px`,
                        backgroundPosition: '0 0',
                        backgroundRepeat: 'no-repeat',
                        border: '1px solid #555', 
                        position: 'relative', 
                        borderRadius: '2px',
                        overflow: 'hidden',
                      }}>
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
                          
                          return (
                            <div 
                              key={j} 
                              onClick={(e) => handleElementSelect(p.elementId, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey })}
                              style={{
                                position: 'absolute', 
                                left: pieceLeftPx, 
                                top: pieceTopPx,
                                width: pieceWpx, 
                                height: pieceHpx,
                                // Show the exact portion of texture for this piece
                                backgroundImage: colorData.texture ? `url(${colorData.texture})` : 'none',
                                backgroundSize: `${tileWpx}px ${tileHpx}px`,
                                backgroundPosition: `-${pieceLeftPx}px -${pieceTopPx}px`,
                                backgroundRepeat: 'no-repeat',
                                overflow: 'hidden',
                                boxSizing: 'border-box',
                                cursor: 'pointer',
                                zIndex: exceeds ? 11 : (shouldHighlight ? 10 : 1),
                              }}
                              title={`${p.name}: ${p.pieceW}×${p.pieceH}cm${exceeds ? ' ⚠️ DEPĂȘEȘTE!' : ''}${isLeftWaterfall ? ' (Cascadă Stânga)' : ''}${isRightWaterfall ? ' (Cascadă Dreapta)' : ''}`}
                            >
                              {/* Semi-transparent overlay for selection/status */}
                              <div style={{
                                position: 'absolute',
                                inset: 0,
                                backgroundColor: overlayColor,
                                border: borderStyle,
                                boxShadow: boxShadowColor !== 'none' ? `0 0 8px ${boxShadowColor}` : 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                color: textColor,
                                fontWeight: (shouldHighlight || exceeds) ? 600 : 500,
                                textShadow: '0 0 2px rgba(0,0,0,0.8)',
                              }}>
                                {/* Render cutouts as dark overlays */}
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
                                      // Rotated 90° CW: x->y, y->width-x
                                      cutLeftPx = userInput.cotaFata * uniformScale - (cutout.radius || 0) * uniformScale;
                                      cutTopPx = (pieceLengthCm - userInput.cotaStanga) * uniformScale - (cutout.radius || 0) * uniformScale;
                                      cutWPx = diameterCm * uniformScale;
                                      cutHPx = diameterCm * uniformScale;
                                    } else {
                                      cutLeftPx = (userInput.cotaStanga - (cutout.radius || 0)) * uniformScale;
                                      cutTopPx = (userInput.cotaFata - (cutout.radius || 0)) * uniformScale;
                                      cutWPx = diameterCm * uniformScale;
                                      cutHPx = diameterCm * uniformScale;
                                    }
                                    
                                    return (
                                      <div
                                        key={cutIdx}
                                        style={{
                                          position: 'absolute',
                                          left: cutLeftPx,
                                          top: cutTopPx,
                                          width: cutWPx,
                                          height: cutHPx,
                                          borderRadius: '50%',
                                          background: 'rgba(30, 30, 30, 0.85)',
                                          border: '1px solid #444',
                                          pointerEvents: 'none',
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
                                      // Rotated 90° CW
                                      cutLeftPx = userInput.cotaFata * uniformScale;
                                      cutTopPx = (pieceLengthCm - userInput.cotaStanga - cutW) * uniformScale;
                                      cutWPx = cutH * uniformScale;
                                      cutHPx = cutW * uniformScale;
                                    } else {
                                      cutLeftPx = userInput.cotaStanga * uniformScale;
                                      cutTopPx = userInput.cotaFata * uniformScale;
                                      cutWPx = cutW * uniformScale;
                                      cutHPx = cutH * uniformScale;
                                    }
                                    
                                    return (
                                      <div
                                        key={cutIdx}
                                        style={{
                                          position: 'absolute',
                                          left: cutLeftPx,
                                          top: cutTopPx,
                                          width: cutWPx,
                                          height: cutHPx,
                                          borderRadius: cornerR,
                                          background: 'rgba(30, 30, 30, 0.85)',
                                          border: '1px solid #444',
                                          pointerEvents: 'none',
                                        }}
                                        title={cutout.name}
                                      />
                                    );
                                  }
                                })}
                                
                                {/* Joint edge indicators */}
                                {shouldHighlight && (isLeftWaterfall || isRightWaterfall) && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 0, left: 0, width: 4, bottom: 0,
                                    background: isLeftWaterfall ? '#4a90d9' : '#5cb85c',
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
                                
                                {/* Label */}
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

      {/* CTA Button */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button 
          onClick={() => setShowConfirmDialog(true)}
          disabled={sendingQuote || hasCutoutErrors}
          style={{ 
            padding: '14px 28px', 
            background: (sendingQuote || hasCutoutErrors) ? '#1a1a1a' : 'transparent', 
            border: `1px solid ${hasCutoutErrors ? '#c96262' : '#c9a962'}`,
            color: hasCutoutErrors ? '#c96262' : '#c9a962', 
            fontWeight: 600, 
            cursor: (sendingQuote || hasCutoutErrors) ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            fontSize: '13px',
            opacity: (sendingQuote || hasCutoutErrors) ? 0.7 : 1,
            transition: 'all 0.2s ease',
          }}
          title={hasCutoutErrors ? 'Corectează erorile la decupaje înainte de a trimite oferta' : ''}
        >
          {sendingQuote ? '⏳ Se trimite...' : (hasCutoutErrors ? '⛔ Erori decupaje' : 'Solicită Ofertă')}
        </button>
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
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConfirmDialog(false)}
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
                style={{
                  padding: '12px 24px',
                  background: '#c9a962',
                  border: 'none',
                  color: '#000',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
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
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>e-blat<span style={{ color: '#c9a962' }}>.ro</span></div>
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


import { describe, it, expect } from 'vitest';
import {
  calculateRetinalParameters,
  imageToSphere,
  calculateMaculaFromDisc,
  mapToSphere,
  angularDistance,
  findPointAtAngle,
  getAnatomyReference,
  getTheoreticalDiscPosition,
  calculateBreakToMacula,
  calculateLimbusDistance,
  getClockHourPosition
} from '../mapper.js';

describe('mapper.js', () => {
  describe('calculateRetinalParameters', () => {
    it('should return correct parameters for standard eye', () => {
      const params = calculateRetinalParameters(24, 200, 2000);
      
      expect(params.axialLength).toBe(24);
      expect(params.retinalRadius).toBe(12);
      expect(params.fov).toBe(200);
      expect(params.degPerPixel).toBe(0.1);
    });
  });

  describe('imageToSphere', () => {
    it('should map center to posterior pole', () => {
      const result = imageToSphere(0.5, 0.5, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
      
      expect(result.theta).toBe(0);
      expect(result.z).toBe(12);
    });

    it('should calculate correct angle for offset point', () => {
      const result = imageToSphere(0.6, 0.5, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
      
      expect(result.isValid).toBe(true);
      expect(result.angleDeg).toBeGreaterThan(0);
    });
  });

  describe('calculateMaculaFromDisc', () => {
    it('should calculate macula position from disc', () => {
      const result = calculateMaculaFromDisc(0.4, 0.5, 200, 2000, 2000);
      
      expect(result.maculaX).toBeGreaterThan(0.4);
      expect(result.maculaY).toBeGreaterThan(0.5);
    });
  });

  describe('angularDistance', () => {
    it('should return 0 for same point', () => {
      const p1 = { theta: 0.1, phi: 0.2 };
      const p2 = { theta: 0.1, phi: 0.2 };
      
      expect(angularDistance(p1, p2)).toBeCloseTo(0, 5);
    });

    it('should calculate correct distance between points', () => {
      const p1 = { theta: 0, phi: 0 };
      const p2 = { theta: Math.PI / 2, phi: 0 };
      
      expect(angularDistance(p1, p2)).toBeCloseTo(90, 5);
    });
  });

  describe('findPointAtAngle', () => {
    it('should find point within tolerance', () => {
      const points = [
        { theta: 0.1, phi: 0.1, data: 'a' },
        { theta: 0.5, phi: 0.5, data: 'b' }
      ];
      
      const result = findPointAtAngle(points, 0.1, 0.1, 5);
      expect(result).not.toBeNull();
      expect(result.data).toBe('a');
    });

    it('should return null when no point within tolerance', () => {
      const points = [
        { theta: 0.5, phi: 0.5 }
      ];
      
      const result = findPointAtAngle(points, 0.1, 0.1, 1);
      expect(result).toBeNull();
    });
  });

  describe('getAnatomyReference', () => {
    it('should return anatomy data', () => {
      const anatomy = getAnatomyReference();
      
      expect(anatomy.discToMaculaAngle).toBe(17);
      expect(anatomy.discToMaculaDistance).toBe(4.5);
    });
  });

  describe('getTheoreticalDiscPosition', () => {
    it('should return disc position for standard eye', () => {
      const disc = getTheoreticalDiscPosition(24);
      
      expect(disc.theta).toBeGreaterThan(0);
      expect(disc.x).toBeDefined();
      expect(disc.y).toBeDefined();
      expect(disc.z).toBeDefined();
    });
  });

  describe('calculateBreakToMacula', () => {
    it('should return 0 for break at macula position', () => {
      const result = calculateBreakToMacula(0.5, 0.5, { x: 0.5, y: 0.5 });
      
      expect(result.distanceMm).toBeCloseTo(0, 5);
      expect(result.angleDeg).toBeCloseTo(0, 5);
      expect(result.theta).toBeCloseTo(0, 5);
    });

    it('should calculate distance without disc calibration', () => {
      const result = calculateBreakToMacula(0.6, 0.5, { x: 0.5, y: 0.5 });
      
      expect(result.distanceMm).toBeGreaterThan(0);
      expect(result.angleDeg).toBeGreaterThan(0);
      expect(result.phi).toBeDefined();
    });

    it('should use disc calibration when provided', () => {
      const result = calculateBreakToMacula(0.4, 0.6, { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.5 });
      
      expect(result.distanceMm).toBeGreaterThan(0);
      expect(result.calibratedMaxAngle).toBeDefined();
      expect(result.phiDeg).toBeDefined();
    });

    it('should calculate correct distance for specific case', () => {
      const result = calculateBreakToMacula(0.5, 0.5, { x: 0.5, y: 0.5 }, undefined, { axialLength: 24, fov: 200 });
      
      expect(result.distanceMm).toBe(0);
      expect(result.angleDeg).toBe(0);
    });

    it('should handle custom axial length', () => {
      const result = calculateBreakToMacula(0.6, 0.5, { x: 0.5, y: 0.5 }, undefined, { axialLength: 26, fov: 200 });
      
      expect(result.distanceMm).toBeGreaterThan(0);
      expect(result.distanceMm).toBeGreaterThan(calculateBreakToMacula(0.6, 0.5, { x: 0.5, y: 0.5 }, undefined, { axialLength: 24, fov: 200 }).distanceMm);
    });
  });

  describe('calculateLimbusDistance', () => {
    it('should return ~30.5mm for theta=0 (break at macula)', () => {
      const result = calculateLimbusDistance(0);
      
      expect(result.arcToMaculaMm).toBe(0);
      expect(result.limbusToBreakMm).toBeCloseTo(30.5, 1);
    });

    it('should calculate arc to macula correctly for 90 degrees', () => {
      const result = calculateLimbusDistance(90);
      
      // R = 12mm, theta = 90deg
      // arcToMaculaMm = 12 * 90 * (π/180) = 12 * π/2 = ~18.85mm
      expect(result.arcToMaculaMm).toBeCloseTo(18.85, 1);
      // limbusToBreak = 30.5 - 18.85 = ~11.65mm
      expect(result.limbusToBreakMm).toBeCloseTo(11.65, 1);
    });

    it('should use custom axial length', () => {
      const resultStandard = calculateLimbusDistance(30, 24);
      const resultLonger = calculateLimbusDistance(30, 26);
      
      // Longer eye should have larger arc
      expect(resultLonger.arcToMaculaMm).toBeGreaterThan(resultStandard.arcToMaculaMm);
    });

    it('should handle 45 degree angle', () => {
      const result = calculateLimbusDistance(45);
      
      // R = 12mm, theta = 45deg
      // arcToMaculaMm = 12 * 45 * (π/180) = 12 * π/4 = ~9.42mm
      expect(result.arcToMaculaMm).toBeCloseTo(9.42, 1);
      expect(result.limbusToBreakMm).toBeCloseTo(21.08, 1);
    });
  });

  describe('getClockHourPosition', () => {
    it('should return 12:00 for phi = π/2 (superior)', () => {
      expect(getClockHourPosition(Math.PI / 2, 'right')).toBe('12:00');
      expect(getClockHourPosition(Math.PI / 2, 'left')).toBe('12:00');
    });

    it('should return 9:00 for phi = 0 (right eye nasal - image right)', () => {
      expect(getClockHourPosition(0, 'right')).toBe('9:00');
    });

    it('should return 3:00 for phi = 0 (left eye temporal - image right)', () => {
      expect(getClockHourPosition(0, 'left')).toBe('3:00');
    });

    it('should return 6:00 for phi = -π/2 (inferior)', () => {
      expect(getClockHourPosition(-Math.PI / 2, 'right')).toBe('6:00');
      expect(getClockHourPosition(-Math.PI / 2, 'left')).toBe('6:00');
    });

    it('should return 3:00 for phi = π (right eye temporal - image left)', () => {
      expect(getClockHourPosition(Math.PI, 'right')).toBe('3:00');
    });

    it('should return 9:00 for phi = π (left eye nasal - image left)', () => {
      expect(getClockHourPosition(Math.PI, 'left')).toBe('9:00');
    });

    it('should return 3:00 for phi = -π (right eye temporal)', () => {
      expect(getClockHourPosition(-Math.PI, 'right')).toBe('3:00');
    });

    it('should default to right eye', () => {
      expect(getClockHourPosition(0)).toBe('9:00');
    });

    it('should handle intermediate angles', () => {
      // phi = π/4 (45°, image upper-right)
      // right eye: nasal-superior → 10:30
      expect(getClockHourPosition(Math.PI / 4, 'right')).toBe('10:30');
      // left eye: temporal-superior → 1:30
      expect(getClockHourPosition(Math.PI / 4, 'left')).toBe('1:30');
      // phi = -π/4 (-45°, image lower-right)
      // right eye: nasal-inferior → 7:30
      expect(getClockHourPosition(-Math.PI / 4, 'right')).toBe('7:30');
      // left eye: temporal-inferior → 4:30
      expect(getClockHourPosition(-Math.PI / 4, 'left')).toBe('4:30');
    });
  });
});
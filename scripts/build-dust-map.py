"""Turns the Edenhofer et al. (2024) 3D dust map into the small grid the sky bake samples.

    python3 -I scripts/build-dust-map.py path/to/mean_and_std_healpix.fits
    python3 -I scripts/build-dust-map.py --fine path/to/COM_CompMap_Dust-GNILC-Model-Opacity_2048_R2.01.fits
    python3 -I scripts/build-dust-map.py --check        (the HEALPix self-checks alone)

Input: the posterior mean of their map, Zenodo 10.5281/zenodo.10658339 (CC BY 4.0): dust density in units of E of
Zhang, Green & Rix (2023) per parsec, on HEALPix spheres (the header says NSIDE and ORDERING) at 516 distances from
69 to 1250 pc, and what lies within 69 pc. Output, in public/dust/: one byte per cell of a grid in galactic longitude,
latitude and distance, 0.5° × 0.5° and 48 shells (the first within 69 pc, then 47 logarithmic ones to 1250 pc),
holding log10 of A_V per kpc, with A_V = 2.8 E as the authors convert; and a JSON description of the grid.

With --fine, what the grid is too coarse to hold: the dust optical depth at 353 GHz of Planck's GNILC map, 5′ (Planck
Collaboration Int. XLVIII 2016, A&A 596, A109; Planck Legacy Archive, or IRSA), HEALPix RING. Output: one byte per 5′
pixel, log10 of a factor on the grid's dust that averages to exactly 1 over each of its cells: the grid says how much
dust a cell holds, Planck only where in the cell it lies. Where Planck sees mostly dust beyond the grid the factor is
weaker; the share comes from the grid the first command wrote, so --fine runs after it.

Only numpy is needed. The HEALPix arithmetic below follows healpix_base.cc (Górski et al. 2005) and is checked by
asserts, and the result is checked against dark clouds whose places are known.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / 'public' / 'dust'
CELL_DEG = 0.5
SUPERSAMPLE = 3  # samples per cell along each axis, averaged
N_SHELLS = 48  # the first holds what lies within the map's inner radius
E_TO_AV = 2.8  # Edenhofer et al. 2024, section 2: "multiplied the unitless ZGR23 extinction by a factor of 2.8"
LOG_MIN, LOG_MAX = -3.0, 3.5  # log10 of A_V per kpc that a byte spans; below LOG_MIN reads as LOG_MIN
FINE = 6  # 5′ pixels per cell along each axis: the beam of the Planck map, and about a texel of the bake
FINE_LOG_MIN, FINE_LOG_MAX = -0.5, 0.5 - 1 / 256  # log10 of the ratio a byte spans; byte 128 is exactly 1
# Galaxies whose own dust the Planck map holds, from SIMBAD: l, b, and 1.5 times the semi-major axis, degrees
OTHER_GALAXIES = {'LMC': (280.4652, -32.8884, 4.0), 'SMC': (302.8084, -44.3277, 2.0), 'M31': (121.1743, -21.5733, 2.5)}

# ---------------------------------------------------------------------------------------------------------------------
# FITS, as much as this file needs

BLOCK = 2880


def parse_value(text):
    text = text.strip()
    if text.startswith("'"):
        end = 1
        while True:
            end = text.index("'", end)
            if end + 1 < len(text) and text[end + 1] == "'":
                end += 2
                continue
            return text[1:end].replace("''", "'").rstrip()
    value = text.split('/')[0].strip()
    if value in ('T', 'F'):
        return value == 'T'
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def read_hdus(path):
    """[(header, data offset, data bytes)] for every HDU in the file."""
    hdus = []
    size = Path(path).stat().st_size
    with open(path, 'rb') as f:
        offset = 0
        while offset < size:
            f.seek(offset)
            header, blocks, done = {}, 0, False
            while not done:
                block = f.read(BLOCK)
                if len(block) < BLOCK:
                    raise ValueError(f'truncated header at byte {offset}')
                blocks += 1
                for i in range(0, BLOCK, 80):
                    card = block[i:i + 80].decode('ascii', 'replace')
                    key = card[:8].strip()
                    if key == 'END':
                        done = True
                        break
                    if card[8:10] == '= ':
                        header[key] = parse_value(card[10:])
            naxis = header.get('NAXIS', 0)
            count = math.prod(header[f'NAXIS{i}'] for i in range(1, naxis + 1)) if naxis else 0
            data = abs(header['BITPIX']) // 8 * count + header.get('PCOUNT', 0)
            data_at = offset + blocks * BLOCK
            hdus.append((header, data_at, data))
            offset = data_at + -(-data // BLOCK) * BLOCK
    return hdus


def image(path, header, at):
    if header['BITPIX'] != -32:
        raise ValueError(f"expected float32 images, got BITPIX {header['BITPIX']}")
    shape = tuple(header[f'NAXIS{i}'] for i in range(header['NAXIS'], 0, -1))
    return np.memmap(path, dtype='>f4', mode='r', offset=at, shape=shape)


TFORM_TYPES = {'L': 'i1', 'B': 'u1', 'I': '>i2', 'J': '>i4', 'K': '>i8', 'E': '>f4', 'D': '>f8', 'A': 'S1'}


def table(path, header, at):
    """A binary table's columns by name, each as an array of shape (rows, repeat)."""
    fields = []
    for n in range(1, header['TFIELDS'] + 1):
        form = header[f'TFORM{n}'].strip()
        digits = ''.join(c for c in form if c.isdigit())
        code = form[len(digits)]
        fields.append((header[f'TTYPE{n}'], TFORM_TYPES[code], int(digits or 1)))
    dtype = np.dtype([(name, kind, (repeat,)) for name, kind, repeat in fields])
    if dtype.itemsize != header['NAXIS1']:
        raise ValueError(f"row of {dtype.itemsize} bytes, header says {header['NAXIS1']}")
    rows = np.fromfile(path, dtype=dtype, count=header['NAXIS2'], offset=at)
    return {name: rows[name] for name, _, _ in fields}

# ---------------------------------------------------------------------------------------------------------------------
# HEALPix, NESTED ordering (healpix_base.cc: pix2loc and loc2pix)

JRLL = np.array([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], dtype=np.int64)
JPLL = np.array([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7], dtype=np.int64)


def compress_bits(v):
    v = v & np.uint64(0x5555555555555555)
    for shift, mask in ((1, 0x3333333333333333), (2, 0x0F0F0F0F0F0F0F0F), (4, 0x00FF00FF00FF00FF), (8, 0x0000FFFF0000FFFF),
                        (16, 0x00000000FFFFFFFF)):
        v = (v | (v >> np.uint64(shift))) & np.uint64(mask)
    return v.astype(np.int64)


def spread_bits(v):
    v = v.astype(np.uint64) & np.uint64(0xFFFFFFFF)
    for shift, mask in ((16, 0x0000FFFF0000FFFF), (8, 0x00FF00FF00FF00FF), (4, 0x0F0F0F0F0F0F0F0F), (2, 0x3333333333333333),
                        (1, 0x5555555555555555)):
        v = (v | (v << np.uint64(shift))) & np.uint64(mask)
    return v.astype(np.int64)


def pix2ang_nest(nside, pix):
    """(z = cos θ, φ) of the centres of NESTED pixels."""
    order = int(math.log2(nside))
    pix = np.asarray(pix, dtype=np.int64)
    face = pix >> (2 * order)
    ipf = (pix & (nside * nside - 1)).astype(np.uint64)
    ix, iy = compress_bits(ipf), compress_bits(ipf >> np.uint64(1))
    jr = (JRLL[face] << order) - ix - iy - 1
    fact2 = 4.0 / (12 * nside * nside)
    fact1 = 2 * nside * fact2
    nl4 = 4 * nside
    north, south = jr < nside, jr > 3 * nside
    nr = np.where(north, jr, np.where(south, nl4 - jr, nside))
    z = np.where(north, 1 - nr * nr * fact2, np.where(south, nr * nr * fact2 - 1, (2 * nside - jr) * fact1))
    kshift = np.where(north | south, 0, (jr - nside) & 1)
    jp = (JPLL[face] * nr + ix - iy + 1 + kshift) // 2
    jp = np.where(jp > nl4, jp - nl4, np.where(jp < 1, jp + nl4, jp))
    return z, (jp - (kshift + 1) * 0.5) * (math.pi / 2 / nr)


def ang2pix_nest(nside, z, phi):
    order = int(math.log2(nside))
    z = np.asarray(z, dtype=np.float64)
    tt = np.mod(phi, 2 * math.pi) / (math.pi / 2)
    za = np.abs(z)
    # equatorial belt
    temp1, temp2 = nside * (0.5 + tt), nside * z * 0.75
    jp, jm = np.floor(temp1 - temp2).astype(np.int64), np.floor(temp1 + temp2).astype(np.int64)
    ifp, ifm = jp >> order, jm >> order
    face_eq = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix_eq, iy_eq = jm & (nside - 1), nside - (jp & (nside - 1)) - 1
    # polar caps
    ntt = np.minimum(3, np.floor(tt).astype(np.int64))
    tp = tt - ntt
    tmp = nside * np.sqrt(3 * (1 - za))
    jpp = np.minimum(np.floor(tp * tmp).astype(np.int64), nside - 1)
    jmp = np.minimum(np.floor((1 - tp) * tmp).astype(np.int64), nside - 1)
    face_p = np.where(z >= 0, ntt, ntt + 8)
    ix_p = np.where(z >= 0, nside - jmp - 1, jpp)
    iy_p = np.where(z >= 0, nside - jpp - 1, jmp)
    belt = za <= 2 / 3
    face = np.where(belt, face_eq, face_p)
    ix, iy = np.where(belt, ix_eq, ix_p), np.where(belt, iy_eq, iy_p)
    return face * nside * nside + spread_bits(ix) + 2 * spread_bits(iy)


# ---------------------------------------------------------------------------------------------------------------------
# HEALPix, RING ordering (healpix_base.cc again), which the Planck map uses


def isqrt(v):
    r = np.floor(np.sqrt(v)).astype(np.int64)
    return r - (r * r > v) + ((r + 1) * (r + 1) <= v)


def pix2ang_ring(nside, pix):
    """(z = cos θ, φ) of the centres of RING pixels."""
    pix = np.asarray(pix, dtype=np.int64)
    npix, ncap, nl4 = 12 * nside * nside, 2 * nside * (nside - 1), 4 * nside
    fact2 = 4.0 / npix
    fact1 = 2 * nside * fact2
    north, south = pix < ncap, pix >= npix - ncap
    # polar caps, rings counted from the nearer pole
    back = npix - pix
    ring = np.where(north, (1 + isqrt(1 + 2 * pix)) >> 1, (1 + isqrt(np.maximum(2 * back - 1, 0))) >> 1)
    iphi = np.where(north, pix + 1 - 2 * ring * (ring - 1), 4 * ring + 1 - (back - 2 * ring * (ring - 1)))
    cap_z = np.where(north, 1 - ring * ring * fact2, ring * ring * fact2 - 1)
    cap_phi = (iphi - 0.5) * (math.pi / 2) / np.maximum(ring, 1)
    # equatorial belt
    tmp = (pix - ncap) // nl4
    belt_ring = tmp + nside
    belt_iphi = pix - ncap - nl4 * tmp + 1
    fodd = np.where((belt_ring + nside) & 1, 1.0, 0.5)
    cap = north | south
    return (np.where(cap, cap_z, (2 * nside - belt_ring) * fact1),
            np.where(cap, cap_phi, (belt_iphi - fodd) * math.pi * 0.75 * fact1))


def ang2pix_ring(nside, z, phi):
    z = np.asarray(z, dtype=np.float64)
    za = np.abs(z)
    tt = np.mod(phi, 2 * math.pi) / (math.pi / 2)  # in [0, 4)
    npix, ncap, nl4 = 12 * nside * nside, 2 * nside * (nside - 1), 4 * nside
    # equatorial belt, rings counted from z = 2/3
    temp1, temp2 = nside * (0.5 + tt), nside * z * 0.75
    jp, jm = np.floor(temp1 - temp2).astype(np.int64), np.floor(temp1 + temp2).astype(np.int64)
    ring = nside + 1 + jp - jm
    kshift = 1 - (ring & 1)
    belt = ncap + (ring - 1) * nl4 + ((jp + jm - nside + kshift + 1 + 2 * nl4) >> 1) % nl4
    # polar caps, rings counted from the nearer pole
    tp = tt - np.floor(tt)
    tmp = nside * np.sqrt(3 * (1 - za))
    ring = np.floor(tp * tmp).astype(np.int64) + np.floor((1 - tp) * tmp).astype(np.int64) + 1
    ip = np.floor(tt * ring).astype(np.int64)
    cap = np.where(z > 0, 2 * ring * (ring - 1) + ip, npix - 2 * ring * (ring + 1) + ip)
    return np.where(za <= 2 / 3, belt, cap)


def check_healpix():
    z, phi = pix2ang_nest(1, np.arange(12))
    assert np.allclose(z, [2 / 3] * 4 + [0] * 4 + [-2 / 3] * 4), z
    assert np.allclose(phi[[0, 4, 8]], [math.pi / 4, 0, math.pi / 4]), phi
    for nside in (1, 2, 16, 256):
        pix = np.arange(12 * nside * nside)
        assert np.array_equal(ang2pix_ring(nside, *pix2ang_ring(nside, pix)), pix), f'RING round trip fails at NSIDE {nside}'
        z, phi = pix2ang_nest(nside, pix)
        assert np.array_equal(ang2pix_nest(nside, z, phi), pix), f'round trip fails at NSIDE {nside}'
        # every NESTED centre is the centre of one RING pixel, so RING rests on the NESTED code checked here
        z_ring, phi_ring = pix2ang_ring(nside, ang2pix_ring(nside, z, phi))
        assert np.allclose(z_ring, z) and np.allclose(np.cos(phi_ring - phi), 1), f'RING and NESTED disagree at NSIDE {nside}'
        # equal areas: a band holds pixels in proportion to its area, so the centres spread evenly in z; at small
        # NSIDE the centres sit on too few rings for ten bands to see that
        if nside >= 256:
            share = np.histogram(z, bins=10, range=(-1, 1))[0] / pix.size
            assert np.all(np.abs(share - 0.1) < 0.006), share
    print('HEALPix NESTED and RING: round trips exact at NSIDE 1, 2, 16 and 256, RING centres on NESTED ones; equal-area')

# ---------------------------------------------------------------------------------------------------------------------


def grid_directions():
    """For every cell, SUPERSAMPLE² sample directions (z, φ) inside it; cells in longitude, then latitude."""
    n_l, n_b = round(360 / CELL_DEG), round(180 / CELL_DEG)
    sub = (np.arange(SUPERSAMPLE) + 0.5) / SUPERSAMPLE
    l = (np.arange(n_l)[:, None] + sub[None, :]).ravel() * CELL_DEG
    b = (np.arange(n_b)[:, None] + sub[None, :]).ravel() * CELL_DEG - 90
    bb, ll = np.meshgrid(b, l, indexing='ij')  # (n_b·S, n_l·S)
    return n_l, n_b, np.sin(np.radians(bb)), np.radians(ll)


def compute(path):
    """(A_V per kpc on the grid, shell edges, the map's radial boundaries), from the map's posterior mean."""
    hdus = read_hdus(path)
    for header, at, size in hdus:
        print('HDU', header.get('XTENSION', 'PRIMARY'), header.get('EXTNAME', ''), [header.get(f'NAXIS{i}') for i in range(1, header.get('NAXIS', 0) + 1)],
              header.get('CTYPE', header.get('CTYPE1', '')), header.get('CUNIT', ''))
    mean = next((h, a) for h, a, _ in hdus if h.get('EXTNAME', '').strip().upper() == 'MEAN')
    header, at = mean
    nside, nest = header['NSIDE'], str(header['ORDERING']).upper().startswith('NEST')
    if not nest:
        raise ValueError('expected NESTED ordering')
    density = image(path, header, at)  # (shells, pixels), E per pc
    tables = [table(path, h, a) for h, a, _ in hdus if h.get('XTENSION', '').strip() == 'BINTABLE']
    radii = next(t for t in tables if 'radial pixel boundaries' in t)
    bounds = np.asarray(radii['radial pixel boundaries'], dtype=np.float64).ravel()
    if bounds.size != density.shape[0] + 1:
        raise ValueError(f'{bounds.size} shell boundaries for {density.shape[0]} shells')
    inner = next(((h, a) for h, a, _ in hdus if 'inner' in str(h.get('CTYPE', h.get('CTYPE1', ''))).lower()
                  and str(h.get('EXTNAME', '')).upper().startswith('MEAN')), None)
    print(f'NSIDE {nside}, NESTED; {density.shape[0]} shells from {bounds[0]:.1f} to {bounds[-1]:.1f} pc; inner map: {inner is not None}')

    n_l, n_b, z, phi = grid_directions()
    samples = ang2pix_nest(nside, z.ravel(), phi.ravel())
    s = SUPERSAMPLE

    def per_cell(values):  # (n_b·S, n_l·S) → (n_b, n_l), each cell the mean of its samples
        return values.reshape(n_b, s, n_l, s).mean(axis=(1, 3))

    # Shells of the output: the first within the map's inner radius, then logarithmic ones to its outer edge
    edges = bounds[0] * (bounds[-1] / bounds[0]) ** (np.arange(N_SHELLS) / (N_SHELLS - 1))
    centres = np.sqrt(bounds[:-1] * bounds[1:])
    shell_of = np.clip(np.searchsorted(edges, centres, side='right'), 1, N_SHELLS - 1)
    widths = np.diff(bounds)
    total = np.zeros((N_SHELLS, n_b, n_l))
    weight = np.zeros(N_SHELLS)
    for k in range(density.shape[0]):
        total[shell_of[k]] += widths[k] * per_cell(np.asarray(density[k])[samples].reshape(z.shape))
        weight[shell_of[k]] += widths[k]
    if inner is not None:
        within = image(path, *inner)  # E integrated over the first bounds[0] pc
        total[0] = per_cell(np.asarray(within).ravel()[samples].reshape(z.shape)) / bounds[0]
        weight[0] = 1
    else:
        total[0], weight[0] = total[1], weight[1]  # the nearest shell's density, carried in to the Sun
    return total / weight[:, None, None] * E_TO_AV * 1000, edges, bounds


def build(path):
    av_per_kpc, edges, bounds = compute(path)
    n_b, n_l = av_per_kpc.shape[1:]
    logs = np.log10(np.maximum(av_per_kpc, 10 ** LOG_MIN))
    print('A_V per kpc, percentiles 1, 50, 99, 99.99 and max:', [f'{10 ** p:.3g}' for p in np.percentile(logs, [1, 50, 99, 99.99, 100])])
    clipped = np.mean(logs > LOG_MAX)
    if clipped > 1e-4:
        raise ValueError(f'{clipped:.2%} of cells above 10^{LOG_MAX} mag/kpc: raise LOG_MAX')

    check_known_clouds(av_per_kpc, edges)

    codes = np.round((logs - LOG_MIN) / (LOG_MAX - LOG_MIN) * 255).astype(np.uint8)  # (shell, latitude, longitude)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'edenhofer2024.bin').write_bytes(codes.tobytes())  # longitude fastest: a WebGL 3D texture's x, y, z
    (OUT / 'edenhofer2024.json').write_text(json.dumps({
        'about': 'A_V per kpc from the 3D dust map of Edenhofer et al. 2024, A&A 685, A82 (CC BY 4.0), Zenodo '
                 '10.5281/zenodo.10658339, posterior mean; A_V = 2.8 E(ZGR23) as the authors convert. Built by '
                 'scripts/build-dust-map.py.',
        'longitudes': n_l, 'latitudes': n_b, 'shells': N_SHELLS,
        'innerPc': round(float(bounds[0]), 3), 'outerPc': round(float(bounds[-1]), 3),
        'logMin': LOG_MIN, 'logMax': LOG_MAX,
    }, indent=1) + '\n')
    print(f"wrote {OUT / 'edenhofer2024.bin'}: {codes.nbytes / 1e6:.1f} MB")


def column(av_per_kpc, edges, l, b, reach_pc=math.inf):
    """A_V from the Sun towards (l, b), degrees, through the shells that begin nearer than `reach_pc`."""
    i, j = int(l / CELL_DEG) % av_per_kpc.shape[2], int((b + 90) / CELL_DEG)
    starts = np.concatenate([[0], edges[:-1]])  # shell 0 within the map's inner radius, shell k from edges[k − 1]
    ends = edges
    use = starts < reach_pc
    return float(np.sum(av_per_kpc[use, j, i] * (ends - starts)[use] / 1000))


# Nearby dark clouds, where SIMBAD puts them (galactic l, b, degrees), and the radius of a ring of sky around each
KNOWN_CLOUDS = {'Coalsack Nebula': (300.71, -0.96, 5), 'TMC-1 (Taurus)': (174.39, -13.43, 8), 'Ophiuchus Molecular Cloud': (353.22, 16.53, 8)}


def check_known_clouds(av_per_kpc, edges):
    """Each cloud must stand out from the sky around it, in the dust nearer than 300 pc where it lies."""
    near = lambda l, b: column(av_per_kpc, edges, l, b, 300)
    for name, (l, b, radius) in KNOWN_CLOUDS.items():
        ring = [near(l + radius * math.cos(a), b + radius * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
        dark = near(l, b)
        print(f'{name}: A_V {dark:.2f} within 300 pc; on a ring of {radius}° around it {np.mean(ring):.2f} on average, {max(ring):.2f} at most')
        assert dark > max(ring) and dark > 1.5 * np.mean(ring), f'{name} does not stand out: the map may not be in galactic coordinates'
    pole = column(av_per_kpc, edges, 0.0, 89.9)
    print(f'north galactic pole: A_V {pole:.3f} through the whole map')
    assert pole < 0.2, pole


def planck_fine(path):
    """Planck's τ353 on 5′ pixels in galactic longitude (fastest) and latitude, each the mean of 2 × 2 samples, plus
    its typical error, which keeps the faintest sky, where the structure is noise, from counting as structure."""
    hdus = read_hdus(path)
    header, at = next((h, a) for h, a, _ in hdus if str(h.get('XTENSION', '')).strip() == 'BINTABLE')
    if header.get('ORDERING') != 'RING' or header.get('COORDSYS') != 'G':
        raise ValueError(f"expected a RING map in galactic coordinates, not {header.get('ORDERING')} in {header.get('COORDSYS')}")
    nside = header['NSIDE']
    some = np.random.default_rng(0).integers(0, 12 * nside * nside, 10 ** 6)
    assert np.array_equal(ang2pix_ring(nside, *pix2ang_ring(nside, some)), some), f'RING round trip fails at NSIDE {nside}'
    columns = table(path, header, at)
    tau, noise = columns['TAU353'].ravel(), float(np.median(columns['ERR_TAU']))
    if not np.all(tau >= 0):
        raise ValueError(f'{np.sum(~(tau >= 0))} pixels with a negative or missing optical depth')
    print(f'NSIDE {nside}, RING, galactic; τ353 from {tau.min():.2e} to {tau.max():.2e}, median error {noise:.2e}')
    n_l, n_b, step = round(360 / CELL_DEG) * FINE, round(180 / CELL_DEG) * FINE, CELL_DEG / FINE
    sub = np.array([0.25, 0.75])
    l = (np.arange(n_l)[:, None] + sub).ravel() * step
    fine = np.empty((n_b, n_l))
    rows = 72
    for j in range(0, n_b, rows):
        bb, ll = np.meshgrid((np.arange(j, j + rows)[:, None] + sub).ravel() * step - 90, l, indexing='ij')
        fine[j:j + rows] = tau[ang2pix_ring(nside, np.sin(np.radians(bb)), np.radians(ll))].reshape(rows, 2, n_l, 2).mean(axis=(1, 3))
    return fine, noise


def check_planck_clouds(fine):
    """Clouds off the plane must stand out in Planck's map where SIMBAD puts them, or the map is misread."""
    step = CELL_DEG / FINE
    at = lambda l, b: fine[int((b + 90) / step), int(l % 360 / step)]
    for name, (l, b, radius) in KNOWN_CLOUDS.items():
        ring = [at(l + radius * math.cos(a), b + radius * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
        print(f'{name}: τ353 {at(l, b):.2e}; on a ring of {radius}° around it at most {max(ring):.2e}')
        # in the plane Planck also sees the dust of the whole Galaxy behind a cloud
        assert abs(b) < 5 or at(l, b) > max(ring), f'{name} does not stand out: the Planck map may be misread'


def near_share(tau_cells):
    """The share of Planck's dust in each cell that lies within the 3D map the build wrote, with A_V per τ353 taken
    where nearly all the dust is near, far from the plane."""
    meta = json.loads((OUT / 'edenhofer2024.json').read_text())
    codes = np.fromfile(OUT / 'edenhofer2024.bin', dtype=np.uint8).reshape(meta['shells'], meta['latitudes'], meta['longitudes'])
    edges = meta['innerPc'] * (meta['outerPc'] / meta['innerPc']) ** (np.arange(meta['shells']) / (meta['shells'] - 1))
    widths = np.diff(np.concatenate([[0], edges])) / 1000
    near = np.tensordot(widths, 10 ** (meta['logMin'] + codes / 255 * (meta['logMax'] - meta['logMin'])), axes=1)
    latitude = np.abs((np.arange(tau_cells.shape[0]) + 0.5) * CELL_DEG - 90)
    av_per_tau = float(np.median((near / tau_cells)[latitude > 30]))
    share = np.clip(near / (av_per_tau * tau_cells), 0, 1)
    print(f'A_V per τ353 at |b| > 30°: {av_per_tau:.3g}; median share of the dust within the map at |b| < 2°, 2–5°, 5–10°, > 10°:',
          [f'{np.median(share[(latitude >= lo) & (latitude < hi)]):.2f}' for lo, hi in ((0, 2), (2, 5), (5, 10), (10, 91))])
    return share


def build_fine(path):
    fine, noise = planck_fine(path)
    check_planck_clouds(fine)
    n_b, n_l = fine.shape
    cells = lambda v: v.reshape(n_b // FINE, FINE, n_l // FINE, FINE).mean(axis=(1, 3))
    # Across the sky the GPU interpolates the grid bilinearly between cell centres, round in longitude and clamped at
    # the poles; the same here, at the centres of the 5′ pixels
    x, y = (np.arange(n_l) + 0.5) / FINE - 0.5, (np.arange(n_b) + 0.5) / FINE - 0.5
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = (x - x0)[None, :], (y - y0)[:, None]
    left, right = x0 % (n_l // FINE), (x0 + 1) % (n_l // FINE)
    low, high = np.clip(y0, 0, n_b // FINE - 1), np.clip(y0 + 1, 0, n_b // FINE - 1)
    spread = lambda c: (c[low][:, left] * (1 - fx) + c[low][:, right] * fx) * (1 - fy) + (c[high][:, left] * (1 - fx) + c[high][:, right] * fx) * fy

    # Planck's relative structure, as a natural log. Planck sees all the dust on a sightline, the map only what lies
    # within 1.25 kpc: in the plane mostly dust kiloparsecs away, whose structure is not the near dust's. If near and
    # far dust are independent and equally clumpy, the near dust's best guess from the total is its relative structure
    # times f / (f² + (1 − f)²), f the near share
    tau_cells = cells(fine)
    share = spread(near_share(tau_cells))
    log_factor = (np.log(fine + noise) - spread(np.log(tau_cells + noise))) * np.minimum(1, share / (share ** 2 + (1 - share) ** 2))
    step = CELL_DEG / FINE
    lc, bc = np.radians((np.arange(n_l) + 0.5) * step), np.radians((np.arange(n_b) + 0.5) * step - 90)
    for l0, b0, radius in OTHER_GALAXIES.values():
        l0, b0 = math.radians(l0), math.radians(b0)
        inside = np.sin(bc)[:, None] * math.sin(b0) + np.cos(bc)[:, None] * math.cos(b0) * np.cos(lc[None, :] - l0) > math.cos(math.radians(radius))
        log_factor[inside] = 0  # its own structure is not the Milky Way's

    # The map says how much dust a cell holds, Planck only where in the cell it lies: a correction, interpolated like the
    # grid so that no seams show, is solved for until the factor averages to 1 over every cell
    correction = np.zeros(tau_cells.shape)
    for _ in range(60):
        correction += np.log(cells(np.exp(log_factor - spread(correction))))
    log_factor -= spread(correction)
    off = float(np.abs(np.log(cells(np.exp(log_factor)))).max())
    print(f'averaged over any cell the factor is 1 to within {off:.1e}')
    assert off < 1e-3, off

    ratio = log_factor / math.log(10)
    print('log10 of the factor, percentiles 0.01, 0.1, 1, 50, 99, 99.9, 99.99:',
          [f'{p:.2f}' for p in np.percentile(ratio, [0.01, 0.1, 1, 50, 99, 99.9, 99.99])])
    clipped = np.mean((ratio < FINE_LOG_MIN) | (ratio > FINE_LOG_MAX))
    if clipped > 1e-4:
        raise ValueError(f'{clipped:.2%} of pixels outside 10^{FINE_LOG_MIN}..10^{FINE_LOG_MAX}: widen the range')

    codes = np.round((ratio - FINE_LOG_MIN) / (FINE_LOG_MAX - FINE_LOG_MIN) * 255).clip(0, 255).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'planck2016.bin').write_bytes(codes.tobytes())  # longitude fastest
    (OUT / 'planck2016.json').write_text(json.dumps({
        'about': 'Dust structure finer than a 0.5° cell, from the Planck GNILC dust optical depth at 353 GHz, 5′ '
                 '(Planck Collaboration Int. XLVIII 2016, A&A 596, A109; ESA/Planck), COM_CompMap_Dust-GNILC-Model-'
                 'Opacity_2048_R2.01.fits: log10 of a factor on the dust of the 3D grid that averages to 1 over each of '
                 'its cells; weaker where Planck sees mostly dust beyond the grid, 1 inside the LMC, SMC and M31. Built '
                 'by scripts/build-dust-map.py --fine.',
        'longitudes': n_l, 'latitudes': n_b, 'logMin': FINE_LOG_MIN, 'logMax': FINE_LOG_MAX,
    }, indent=1) + '\n')
    print(f"wrote {OUT / 'planck2016.bin'}: {codes.nbytes / 1e6:.1f} MB")


if __name__ == '__main__':
    check_healpix()
    if sys.argv[1:2] == ['--fine'] and len(sys.argv) == 3:
        build_fine(sys.argv[2])
    elif sys.argv[1:] != ['--check']:
        if len(sys.argv) != 2:
            sys.exit(__doc__)
        build(sys.argv[1])

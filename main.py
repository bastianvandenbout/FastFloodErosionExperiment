import http.server
import socketserver
import webbrowser
import json
import math
import random
import os
import urllib.parse
from threading import Timer

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def generate_terrain(slope_multiplier=1.0, texture_multiplier=1.0):
    """
    Generates a 1000-item terrain profile.
    - dx: 2.5 meters spacing (total 2.5 km).
    - Slopes have high-amplitude waves combined with base decay to create pools, flats, and rapids.
    - Minimum slope is enforced at 1e-4 (minimum height difference of 1e-4 per cell).
    - Elevation of each next cell is lower than the previous by its slope.
    - Distance is index * dx.
    - Manning's n is segmented into 10-20 cell blocks of 0.05, 0.1, or 0.15.
    - Cohesion is between 1 and 10 kPa.
    - Grain size (d50) is between clay (0.001mm) and silt (0.05mm).
    """
    num_cells = 1000
    dx = 2.5  # Spacing in meters (total 2500m / 2.5km)
    
    slopes = []
    elevations = []
    current_elevation = 100.0  # Starting elevation
    elevations.append(current_elevation)
    
    # Initialize variables to fix NameError
    segment_length = 0
    cohesions = []
    grain_sizes = []
    
    # Manning segments (10 to 20 cells of 0.05, 0.1, 0.15)
    manning_choices = [0.05, 0.1, 0.15]
    manning = []
    current_manning = random.choice(manning_choices)
    # Pre-generate random wave parameters (frequencies, amplitudes, phase shifts)
    # to ensure each regenerated profile is uniquely shaped!
    random_waves = [
        {
            "amp": random.uniform(0.012, 0.028),
            "freq": random.uniform(6.0, 14.0),
            "phase": random.uniform(0, 2 * math.pi)
        },
        {
            "amp": random.uniform(0.006, 0.016),
            "freq": random.uniform(22.0, 38.0),
            "phase": random.uniform(0, 2 * math.pi)
        },
        {
            "amp": random.uniform(0.003, 0.009),
            "freq": random.uniform(50.0, 85.0),
            "phase": random.uniform(0, 2 * math.pi)
        }
    ]
    
    for i in range(num_cells):
        # Progress fraction along the profile
        frac = i / (num_cells - 1)
        
        # Steep to flat base decay
        base_slope = 0.05 * math.pow(1.0 - frac, 1.5) * slope_multiplier
        
        # Strong wave variations to generate terraced steps (pools & rapids)
        wave_variation = 0.0
        for w in random_waves:
            wave_variation += w["amp"] * math.sin(frac * w["freq"] + w["phase"])
        wave_variation *= slope_multiplier
        
        # Random noise
        noise = (random.random() - 0.5) * 0.015 * slope_multiplier
        
        slope = base_slope + wave_variation + noise
        
        # Enforce minimum height difference of 1e-4
        if slope < 1e-4:
            slope = 1e-4
            
        slopes.append(slope)
        
        # Next cell elevation is lower than previous by the slope amount
        if i > 0:
            current_elevation -= slope
            elevations.append(current_elevation)
            
        # Manning segmentation
        if segment_length <= 0:
            current_manning = random.choice(manning_choices)
            segment_length = random.randint(10, 20)
        manning.append(current_manning)
        segment_length -= 1
        
        # Cohesion: between 1 and 10 kPa
        cohesion = 1.0 + random.random() * 9.0
        cohesions.append(cohesion)
        
        # Grain size (d50): between clay (0.001 mm) and silt (0.05 mm)
        # Adjust average texture via multiplier
        d50 = (0.001 + random.random() * 0.049) * texture_multiplier
        grain_sizes.append(d50)
        
    distances = [i * dx for i in range(num_cells)]
    
    return {
        "distances": distances,
        "elevations": elevations,
        "slopes": slopes,
        "manning": manning,
        "cohesion": cohesions,
        "grain_sizes": grain_sizes
    }

class TerrainServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve from the directory where main.py resides
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/data':
            # Parse parameters
            query_params = urllib.parse.parse_qs(parsed_url.query)
            
            slope_mult = 1.0
            texture_mult = 1.0
            
            try:
                if 'slope_mult' in query_params:
                    slope_mult = float(query_params['slope_mult'][0])
                if 'texture_mult' in query_params:
                    texture_mult = float(query_params['texture_mult'][0])
            except ValueError:
                pass
                
            # Generate the new terrain
            data = generate_terrain(slope_mult, texture_mult)
            
            # Send JSON response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        else:
            # Default to serving static files
            super().do_GET()

def open_browser():
    webbrowser.open_new(f"http://localhost:{PORT}")

if __name__ == "__main__":
    # Change working directory to where main.py is to ensure correct serving path
    os.chdir(DIRECTORY)
    
    # Start server
    handler = TerrainServerHandler
    # Enable socket re-use to prevent "Address already in use" errors on restarts
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"Server started at http://localhost:{PORT}")
        print("Serving 1D Runoff & Erosion visualization dashboard...")
        
        # Open the browser in a separate thread after 1 second to let server bind
        Timer(1.0, open_browser).start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.shutdown()

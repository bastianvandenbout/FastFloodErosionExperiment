# FastFloodErosionExperiment
A profile viewed, catchment scale runoff, hydrolody and erosion simulation based on the event-based method applied in FastFlood

# How to run
clone and go to the folder,
Run: 
python main.py

And go to http://localhost:8000/ to view.

#How it works
The script calls python functions to generate a random catchment (with a expending width as you go upstream, tree-shape)
and a fixed length. 
The catchment has random slopes, land use, infiltration and soil properties (ksat/cohesion)
It then runns a Green and Ampt infiltration model to generate runoff.
It applies the event-based approach used in FastFlood to quickly estimate hydrographs at any point.
Then, it does a time-discretized erosion sedogarph estimation along the catchment, propagating the solution downstream.
Erosion is Transport Capacity based, similar to LISEM in some ways (Govers et al equations based on streampower), and deposition and erosion efficiency limited by settling velocity.

<img width="3350" height="1961" alt="image" src="https://github.com/user-attachments/assets/85180a22-434a-452b-8b70-30700702c1af" />

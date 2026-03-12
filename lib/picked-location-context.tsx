import React, { createContext, useCallback, useContext, useState } from "react";

interface PickedLocation {
  lat: number;
  lng: number;
  label: string;
  timestamp: number;
}

interface PickedLocationContextValue {
  pickedLocation: PickedLocation | null;
  setPickedLocation: (lat: number, lng: number, label: string) => void;
}

const PickedLocationContext = createContext<PickedLocationContextValue>({
  pickedLocation: null,
  setPickedLocation: () => {},
});

export function PickedLocationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pickedLocation, setLocation] = useState<PickedLocation | null>(null);

  const setPickedLocation = useCallback(
    (lat: number, lng: number, label: string) => {
      setLocation({ lat, lng, label, timestamp: Date.now() });
    },
    [],
  );

  return (
    <PickedLocationContext.Provider
      value={{ pickedLocation, setPickedLocation }}
    >
      {children}
    </PickedLocationContext.Provider>
  );
}

export function usePickedLocation() {
  return useContext(PickedLocationContext);
}

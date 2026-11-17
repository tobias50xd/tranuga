import { describe, expect, it, vi } from 'vitest';
import { getCurrentLocation } from '../src/location';

const fix=(latitude=33.948,longitude=-83.377,accuracy=20)=>({coords:{latitude,longitude,accuracy},timestamp:1800000000000}) as GeolocationPosition;
describe('explicit browser location requests',()=>{
  it('requests one accurate fix with a bounded timeout/cache and preserves the reported accuracy',async()=>{
    const getCurrentPosition=vi.fn((success:PositionCallback)=>success(fix()));
    expect(await getCurrentLocation({getCurrentPosition})).toEqual({lat:33.948,lon:-83.377,accuracy:20});
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function),expect.any(Function),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });
  it.each([[NaN,-83.377],[91,-83.377],[33.948,Infinity],[33.948,-181]])('rejects invalid coordinates (%s, %s)',async(lat,lon)=>{
    await expect(getCurrentLocation({getCurrentPosition:success=>success(fix(lat,lon))})).rejects.toThrow('invalid location');
  });
  it('does not invent accuracy when the browser supplies an invalid value',async()=>{
    expect(await getCurrentLocation({getCurrentPosition:success=>success(fix(33.948,-83.377,NaN))})).toEqual({lat:33.948,lon:-83.377,accuracy:undefined});
  });
  it.each([[1,'permission was denied'],[2,'Could not determine'],[3,'timed out']])('explains browser failure %s',async(code,message)=>{
    await expect(getCurrentLocation({getCurrentPosition:(_success,error)=>error?.({code} as GeolocationPositionError)})).rejects.toThrow(message);
  });
  it('explains when location is not supported',async()=>{
    vi.stubGlobal('navigator',{});
    try { await expect(getCurrentLocation()).rejects.toThrow('unavailable in this browser'); }
    finally { vi.unstubAllGlobals(); }
  });
});

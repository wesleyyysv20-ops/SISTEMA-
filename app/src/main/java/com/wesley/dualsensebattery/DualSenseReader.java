package com.wesley.dualsensebattery;
import android.hardware.BatteryState;
import android.view.InputDevice;
import java.util.Locale;
public final class DualSenseReader {
 private static final int SONY=0x054C;
 public static DualSenseInfo read(){ DualSenseInfo o=new DualSenseInfo(); for(int id:InputDevice.getDeviceIds()){ InputDevice d=InputDevice.getDevice(id); if(d==null)continue; int s=d.getSources(); boolean pad=(s&InputDevice.SOURCE_GAMEPAD)==InputDevice.SOURCE_GAMEPAD||(s&InputDevice.SOURCE_JOYSTICK)==InputDevice.SOURCE_JOYSTICK; String n=d.getName()==null?"":d.getName().toLowerCase(Locale.ROOT); boolean ds=d.getVendorId()==SONY||n.contains("dualsense")||n.contains("wireless controller"); if(!pad||!ds)continue; o.connected=true; try{ BatteryState b=d.getBatteryState(); if(b!=null&&b.isPresent()){ float c=b.getCapacity(); if(!Float.isNaN(c)&&c>=0)o.percent=Math.max(0,Math.min(100,Math.round(c*100f))); o.stateText=status(b.getStatus()); } else o.stateText="Bateria não informada pelo Android"; }catch(Throwable t){o.stateText="Bateria indisponível";} return o;} return o; }
 private static String status(int s){ switch(s){case BatteryState.STATUS_CHARGING:return "Carregando";case BatteryState.STATUS_DISCHARGING:return "Em uso";case BatteryState.STATUS_FULL:return "Carga completa";case BatteryState.STATUS_NOT_CHARGING:return "Conectado à energia";default:return "Estado desconhecido";} }
}

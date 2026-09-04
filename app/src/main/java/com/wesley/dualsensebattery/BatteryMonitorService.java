package com.wesley.dualsensebattery;
import android.app.*;import android.content.*;import android.os.*;
public class BatteryMonitorService extends Service{
 static final String CH="dualsense_battery";static final int ID=5412;final Handler h=new Handler(Looper.getMainLooper());
 final Runnable r=new Runnable(){public void run(){update();h.postDelayed(this,15000);}};
 public void onCreate(){super.onCreate();NotificationChannel c=new NotificationChannel(CH,"Bateria do DualSense",NotificationManager.IMPORTANCE_LOW);c.setDescription("Mostra continuamente a bateria do DualSense");c.setShowBadge(false);getSystemService(NotificationManager.class).createNotificationChannel(c);}
 public int onStartCommand(Intent i,int f,int id){startForeground(ID,notification(DualSenseReader.read()));h.removeCallbacks(r);h.postDelayed(r,15000);return START_STICKY;}
 void update(){getSystemService(NotificationManager.class).notify(ID,notification(DualSenseReader.read()));}
 Notification notification(DualSenseInfo x){PendingIntent p=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);String title,text;if(!x.connected){title="DualSense • desconectado";text="Aguardando o controle";}else if(x.percent>=0){title="DualSense • "+x.percent+"%";text=x.stateText;}else{title="DualSense conectado";text="Bateria indisponível no Android";}Notification.Builder b=new Notification.Builder(this,CH).setSmallIcon(R.drawable.ic_gamepad).setContentTitle(title).setContentText(text).setContentIntent(p).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC);if(x.percent>=0){b.setProgress(100,x.percent,false);b.setSubText(x.percent+"%");}return b.build();}
 public void onDestroy(){h.removeCallbacks(r);super.onDestroy();}public IBinder onBind(Intent i){return null;}
}

# st-isy-notify-bridge
Acts as a proxy between the SmartThings hub and the ISY 994i Hub. The notification requests the ISY makes are rejected
by the ISY as invalid even though they technically aren't. So this server just acts as a man in the middle and rewrites
the notifications so they will be accepted by SmartThings.

See the github.com/rodtoll/smartthings-isy project for more details.



